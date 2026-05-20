#!/usr/bin/env node
/**
 * decisao.mjs — Motor "Decisão do Dia" (COMPRE AGORA / ATENÇÃO / PODE ESPERAR)
 *
 * Roda no GitHub Actions APÓS gerar-painel.mjs. Lê data.json, opcionalmente
 * consulta o Supabase do monitor de preços (custo distribuidora + ANP histórico),
 * calcula um veredito determinístico por combustível e grava `data.json.decisao`.
 *
 * 100% determinístico — ZERO IA. Defensivo: se o Supabase falhar ou colunas
 * não baterem, calcula só com data.json (ABICOM + Brent/câmbio + manchete) e
 * usa sparkline neutra. O painel nunca quebra por causa disso.
 *
 * Env:
 *   DATA_PATH        — default data.json
 *   SUPABASE_DB_URL  — opcional. Se ausente, modo degradado (só data.json).
 */
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = process.env.DATA_PATH || "data.json";
const SUPA = process.env.SUPABASE_DB_URL || "";

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

function pctNum(s) {
  if (s == null) return null;
  const m = String(s).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function rsNum(s) {
  // "R$ 1,12/L" / "R$ 1,03" / "1,12" -> 1.12 | null
  if (s == null) return null;
  const m = String(s).replace(/[Rr]\$\s*/, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const ab = data.abicom || {};
const defGas = pctNum(ab.defasagem_gasolina_pct);
const defDie = pctNum(ab.defasagem_diesel_pct);
const diasGas = Number(ab.dias_sem_ajuste_gasolina) || 0;
const diasDie = Number(ab.dias_sem_ajuste_diesel) || 0;
const potGas = rsNum(ab.potencial_aumento_rs_gasolina);   // R$/L que Petrobras precisa subir
const potDie = rsNum(ab.potencial_aumento_rs_diesel);
const brentDir = (data.petroleo?.brent?.dir || "flat").toLowerCase();
const usdDir = (data.moedas?.usdbrl?.dir || "flat").toLowerCase();

const mancheteTxt = (
  (data.manchete?.principal?.titulo || "") + " " +
  (data.manchete?.secundarias || []).map(s => s.titulo).join(" ") + " " +
  (data.resumo_editorial || "")
).toLowerCase();

// Sinal regulatório/Petrobras — categorizado, em ordem de força
function classifyGovSignal() {
  const explicit = String(ab.sinal_petrobras || "").toLowerCase();
  if (explicit && explicit !== "nenhum") return explicit;
  // Fallback heurístico no texto
  if (/reajustou|subiu.*pre[çc]o|aumentou.*pre[çc]o|petrobras.*aumenta|novo pre[çc]o.*entra/.test(mancheteTxt)) return "reajustou_recente";
  if (/n[ãa]o.*importar|n[ãa]o.*vai.*importar|janelas.*fechad|n[ãa]o importar[áa]/.test(mancheteTxt)) return "nao_importa";
  if (/medida provis[óo]ria|\bmp\b.*subsidio|\bmp\b.*cide|isen[çc][ãa]o.*pis|cide.*reduz/.test(mancheteTxt)) return "mp_subsidio";
  if (/reajuste.*iminente|anuncia.*reajuste|j[áa].*j[áa]|chambriard.*j[áa]|reajuste.*previsto/.test(mancheteTxt)) return "reajuste_anunciado";
  if (/reajust|petrobras|aumento.*combust|sobe.*combust/.test(mancheteTxt)) return "manchete_pressao";
  return "nenhum";
}
const govSignalType = classifyGovSignal();

// ---- Supabase: tendência de custo distribuidora + sparkline (best-effort) ----
async function supabaseTrends() {
  const out = { gasolina: null, diesel_s10: null, diesel_s500: null, etanol: null,
                spark: { gasolina: null, diesel_s10: null, diesel_s500: null, etanol: null } };
  if (!SUPA) { console.log("ℹ️  SUPABASE_DB_URL ausente — modo degradado (só data.json)"); return out; }
  let pg;
  try { pg = await import("pg"); } catch { console.log("⚠️  módulo pg indisponível — modo degradado"); return out; }
  const client = new pg.default.Client({ connectionString: SUPA, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    // Descobre as colunas de combustível da tabela de distribuidoras
    const cols = (await client.query(
      `select column_name from information_schema.columns where table_name='precos_distribuicao_manual'`
    )).rows.map(r => r.column_name);
    const findCol = (re) => cols.find(c => re.test(c));
    const map = {
      gasolina:   findCol(/gasolina/i),
      etanol:     findCol(/etanol/i),
      diesel_s10: findCol(/diesel.*s.?10|s10/i),
      diesel_s500:findCol(/diesel.*s.?500|s500/i),
    };
    for (const [fuel, col] of Object.entries(map)) {
      if (!col) continue;
      // média por data_coleta (nacional), últimas ~12 coletas
      const q = await client.query(
        `select data_coleta::date d, avg(nullif(${col},0)) v
           from precos_distribuicao_manual
          where ${col} is not null and ${col} > 0
          group by 1 order by 1 desc limit 12`
      );
      const rows = q.rows.map(r => ({ d: r.d, v: Number(r.v) })).filter(r => isFinite(r.v) && r.v > 0).reverse();
      if (rows.length >= 2) {
        out.spark[fuel] = rows.slice(-10).map(r => r.v);
        const half = Math.max(1, Math.floor(rows.length / 2));
        const recent = rows.slice(-half).reduce((a, r) => a + r.v, 0) / half;
        const prev = rows.slice(0, half).reduce((a, r) => a + r.v, 0) / half;
        if (prev > 0) out[fuel] = ((recent - prev) / prev) * 100; // % variação
      }
    }
    console.log("✓ Supabase: tendências de custo distribuidora obtidas");
  } catch (e) {
    console.log("⚠️  Supabase falhou (" + e.message + ") — modo degradado");
  } finally {
    try { await client.end(); } catch {}
  }
  return out;
}

function sparkNormalize(arr) {
  // converte série de preços em 10 alturas 0-100 (relativo min/max da própria série)
  if (!arr || arr.length < 2) return null;
  const a = arr.slice(-10);
  const mn = Math.min(...a), mx = Math.max(...a);
  const span = mx - mn || 1;
  return a.map(v => Math.round(8 + ((v - mn) / span) * 92));
}

function verdict(score) {
  if (score >= 65) return { verdict: "buy",  label: "COMPRE AGORA", emoji: "🔴" };
  if (score >= 35) return { verdict: "warn", label: "ATENÇÃO",      emoji: "🟡" };
  return                 { verdict: "wait", label: "PODE ESPERAR",  emoji: "🟢" };
}

function finalize(key, nome, score, reasons, spark) {
  score = Math.max(0, Math.min(100, Math.round(score)));
  const v = verdict(score);
  // Ordena razões: 'up' primeiro (decisivas pra alta), depois 'down', depois 'flat'
  const ord = { up: 0, down: 1, flat: 2 };
  reasons.sort((a, b) => (ord[a.dir] ?? 9) - (ord[b.dir] ?? 9));
  return {
    key, nome,
    verdict: v.verdict, label: v.label, emoji: v.emoji, score,
    spark: sparkNormalize(spark) || [],
    reasons: reasons.slice(0, 5)
  };
}

// Motor v2 (2026-05-20): tiers granulares, sinergia defasagem×dias,
// peso forte pro potencial R$/L, sinal regulatório categorizado, cooldown pós-reajuste.
function buildFuel({ nome, key, defasagem, dias, distTrend, potencialRs, spark, isEtanol }) {
  let score = 0;
  const reasons = [];
  const fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",");

  // COOLDOWN: Petrobras reajustou recentemente → pressão zerada
  if (govSignalType === "reajustou_recente") {
    score = 8;
    reasons.push({ dir: "down", text: `Petrobras reajustou recentemente — pressão zerada por enquanto` });
    if (distTrend != null && distTrend <= -1) reasons.push({ dir: "down", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (caindo)` });
    return finalize(key, nome, score, reasons, spark);
  }

  // 1. POTENCIAL DE AUMENTO em R$/L — sinal mais direto pra "quanto pode subir"
  if (!isEtanol && potencialRs != null && potencialRs > 0) {
    if (potencialRs >= 1.0) { score += 40; reasons.push({ dir: "up", text: `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> pra alcançar paridade (ABICOM)` }); }
    else if (potencialRs >= 0.5) { score += 25; reasons.push({ dir: "up", text: `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (zona de atenção)` }); }
    else if (potencialRs >= 0.2) { score += 10; reasons.push({ dir: "flat", text: `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (baixo)` }); }
  }

  // 2. DEFASAGEM % — tiers granulares
  if (!isEtanol && defasagem != null) {
    if (defasagem >= 80) { score += 50; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (histórica)` }); }
    else if (defasagem >= 60) { score += 38; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (crítica)` }); }
    else if (defasagem >= 40) { score += 28; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (alta)` }); }
    else if (defasagem >= 25) { score += 16; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (zona de atenção)` }); }
    else if (defasagem >= 10) { score += 6; reasons.push({ dir: "flat", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (baixa)` }); }
    else if (defasagem < 0) { reasons.push({ dir: "down", text: `Defasagem <b>${defasagem.toFixed(0)}%</b> (Petrobras acima da paridade)` }); }
  }

  // 3. DIAS JANELAS FECHADAS — tiers granulares
  if (!isEtanol && dias > 0) {
    if (dias >= 90) { score += 28; reasons.push({ dir: "up", text: `<b>${dias} dias</b> de janelas fechadas (Petrobras sem importar há muito)` }); }
    else if (dias >= 60) { score += 20; reasons.push({ dir: "up", text: `<b>${dias} dias</b> sem importação/reajuste` }); }
    else if (dias >= 40) { score += 12; reasons.push({ dir: "up", text: `<b>${dias} dias</b> sem importação` }); }
    else if (dias >= 20) { score += 5; reasons.push({ dir: "flat", text: `<b>${dias} dias</b> sem importação` }); }
  }

  // 4. SINERGIA defasagem alta + dias acumulados
  if (!isEtanol && defasagem != null && dias > 0) {
    if (defasagem >= 60 && dias >= 90) { score += 12; reasons.push({ dir: "up", text: `Sinergia: defasagem crítica + janelas fechadas há muito = pressão máxima` }); }
    else if (defasagem >= 40 && dias >= 60) { score += 8; reasons.push({ dir: "up", text: `Sinergia: defasagem alta + dias acumulados` }); }
  }

  // 5. CUSTO DISTRIBUIDORA (peso maior pro etanol — é o sinal principal dele)
  if (distTrend != null) {
    const wMul = isEtanol ? 1.4 : 1.0;
    if (distTrend >= 5) { score += Math.round(25 * wMul); reasons.push({ dir: "up", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (subindo forte)` }); }
    else if (distTrend >= 3) { score += Math.round(18 * wMul); reasons.push({ dir: "up", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> nas últimas 2 semanas` }); }
    else if (distTrend >= 1) { score += Math.round(8 * wMul); reasons.push({ dir: "up", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (leve)` }); }
    else if (distTrend <= -2) { score -= Math.round(12 * wMul); reasons.push({ dir: "down", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (caindo)` }); }
    else if (distTrend <= -0.5) { score -= 5; reasons.push({ dir: "down", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (queda leve)` }); }
    else { reasons.push({ dir: "flat", text: `Custo distribuidora estável (${fmt(distTrend)}%)` }); }
  }

  // 6. MACRO
  if (brentDir === "up") { score += 12; reasons.push({ dir: "up", text: `Brent subindo — pressão no custo de reposição` }); }
  else if (brentDir === "down") { score -= 5; reasons.push({ dir: "down", text: `Brent em queda — alivia custo` }); }
  if (usdDir === "up") { score += 8; reasons.push({ dir: "up", text: `Dólar subindo — encarece importação` }); }
  else if (usdDir === "down") { reasons.push({ dir: "down", text: `Dólar em queda — alivia importação` }); }

  // 7. SINAL REGULATÓRIO categorizado (excluindo "reajustou_recente" tratado no topo)
  if (govSignalType === "reajuste_anunciado") { score += 18; reasons.push({ dir: "up", text: `Petrobras anunciou reajuste iminente` }); }
  else if (govSignalType === "mp_subsidio") { score += 14; reasons.push({ dir: "up", text: `MP/subsídio anunciada — sinal de que o reajuste vem (governo se preparando)` }); }
  else if (govSignalType === "nao_importa") { score += 10; reasons.push({ dir: "up", text: `Petrobras anunciou que não vai importar — defasagem deve persistir` }); }
  else if (govSignalType === "manchete_pressao") { score += 6; reasons.push({ dir: "up", text: `Sinal de pressão na manchete` }); }

  // 8. ETANOL — bônus especializado (mandato anidro)
  if (isEtanol) {
    const anidroPct = pctNum(data.mandatos?.anidro_na_gasolina_pct);
    if (anidroPct != null && anidroPct >= 30) { score += 5; reasons.push({ dir: "flat", text: `Mandato anidro em <b>${anidroPct}%</b> — consumo estrutural elevado` }); }
    if (reasons.length === 0) { reasons.push({ dir: "flat", text: `Sem pressão de alta detectada — giro normal de estoque` }); }
  }

  return finalize(key, nome, score, reasons, spark);
}

(async () => {
  const t = await supabaseTrends();

  const fuels = [
    buildFuel({ nome: "⛽ Gasolina",   key: "gasolina",   defasagem: defGas, dias: diasGas, distTrend: t.gasolina,   potencialRs: potGas, spark: t.spark.gasolina }),
    buildFuel({ nome: "🚚 Diesel S10",  key: "diesel_s10",  defasagem: defDie, dias: diasDie, distTrend: t.diesel_s10, potencialRs: potDie, spark: t.spark.diesel_s10 }),
    buildFuel({ nome: "🚛 Diesel S500", key: "diesel_s500", defasagem: defDie, dias: diasDie, distTrend: t.diesel_s500, potencialRs: potDie, spark: t.spark.diesel_s500 }),
    buildFuel({ nome: "🌱 Etanol",      key: "etanol",      defasagem: null,   dias: 0,       distTrend: t.etanol,     potencialRs: null,   spark: t.spark.etanol, isEtanol: true }),
  ];

  data.decisao = {
    data_label: data.meta?.date_label || "",
    base: SUPA ? "ABICOM + custo distribuidora (monitor de preços) + Brent/câmbio" : "ABICOM + Brent/câmbio (custo distribuidora indisponível)",
    disclaimer: "Essa não é uma recomendação de compra, apenas uma sugestão baseada num modelo educacional.",
    fuels
  };

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log("✓ Decisão do Dia gravada em " + DATA_PATH);
  for (const f of fuels) console.log(`  ${f.emoji} ${f.nome}: ${f.label} (${f.score}/100)`);
  process.exit(0);
})();
