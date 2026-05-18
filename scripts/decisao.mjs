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
  // "73%" / "~39%" / "73,5%" -> 73 (number) | null
  if (s == null) return null;
  const m = String(s).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const ab = data.abicom || {};
const defGas = pctNum(ab.defasagem_gasolina_pct);
const defDie = pctNum(ab.defasagem_diesel_pct);
const diasGas = Number(ab.dias_sem_ajuste_gasolina) || 0;
const diasDie = Number(ab.dias_sem_ajuste_diesel) || 0;
const brentDir = (data.petroleo?.brent?.dir || "flat").toLowerCase();
const usdDir = (data.moedas?.usdbrl?.dir || "flat").toLowerCase();
const cepeaDir = ((data.cepea?.hidratado_sp || "") + (data.cepea?.anidro_sp || "")); // só p/ heurística leve
const mancheteTxt = (
  (data.manchete?.principal?.titulo || "") + " " +
  (data.manchete?.secundarias || []).map(s => s.titulo).join(" ") + " " +
  (data.resumo_editorial || "")
).toLowerCase();
const govSignal = /reajust|petrobras|medida provis|\bmp\b|aumento.*combust|sobe.*combust/.test(mancheteTxt);

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
  if (score >= 70) return { verdict: "buy",  label: "COMPRE AGORA", emoji: "🔴" };
  if (score >= 40) return { verdict: "warn", label: "ATENÇÃO",      emoji: "🟡" };
  return                 { verdict: "wait", label: "PODE ESPERAR",  emoji: "🟢" };
}

function dirArrow(d) { return d === "up" ? "up" : d === "down" ? "down" : "flat"; }

function buildFuel({ nome, key, defasagem, dias, distTrend, spark, isEtanol }) {
  let score = 0;
  const reasons = [];

  if (!isEtanol && defasagem != null) {
    if (defasagem >= 50) { score += 40; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (acima do gatilho de 50%)` }); }
    else if (defasagem >= 25) { score += 20; reasons.push({ dir: "up", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (zona de atenção)` }); }
    else if (defasagem >= 10) { score += 8; reasons.push({ dir: "flat", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (baixa)` }); }
    else if (defasagem < 0) { reasons.push({ dir: "down", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (Petrobras acima da paridade)` }); }
  }
  if (!isEtanol && dias > 0) {
    if (dias >= 60) { score += 25; reasons.push({ dir: "up", text: `<b>${dias} dias</b> sem reajuste Petrobras` }); }
    else if (dias >= 30) { score += 12; reasons.push({ dir: "up", text: `<b>${dias} dias</b> sem reajuste` }); }
  }
  if (distTrend != null) {
    const dt = (v) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",");
    if (distTrend >= 3) { score += 20; reasons.push({ dir: "up", text: `Custo distribuidora <b>${dt(distTrend)}%</b> nas últimas 2 semanas` }); }
    else if (distTrend >= 1) { score += 8; reasons.push({ dir: "up", text: `Custo distribuidora <b>${dt(distTrend)}%</b> (leve)` }); }
    else if (distTrend <= -1) { score -= 10; reasons.push({ dir: "down", text: `Custo distribuidora <b>${dt(distTrend)}%</b> (caindo)` }); }
    else { reasons.push({ dir: "flat", text: `Custo distribuidora estável (${dt(distTrend)}%)` }); }
  }
  if (brentDir === "up") { score += 15; reasons.push({ dir: "up", text: `Brent subindo — pressão no custo de reposição` }); }
  else if (brentDir === "down") { reasons.push({ dir: "down", text: `Brent em queda — alivia custo` }); }
  if (usdDir === "up") { score += 15; reasons.push({ dir: "up", text: `Dólar subindo — encarece importação` }); }
  if (govSignal) { score += 15; reasons.push({ dir: "up", text: `Sinal de reajuste na manchete (governo/Petrobras)` }); }

  if (isEtanol && reasons.length === 0) {
    reasons.push({ dir: "flat", text: `Sem pressão de alta detectada — giro normal de estoque` });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const v = verdict(score);
  return {
    key, nome,
    verdict: v.verdict, label: v.label, emoji: v.emoji, score,
    spark: sparkNormalize(spark) || [],
    reasons: reasons.slice(0, 4)
  };
}

(async () => {
  const t = await supabaseTrends();

  const fuels = [
    buildFuel({ nome: "⛽ Gasolina",   key: "gasolina",   defasagem: defGas, dias: diasGas, distTrend: t.gasolina,   spark: t.spark.gasolina }),
    buildFuel({ nome: "🚚 Diesel S10",  key: "diesel_s10",  defasagem: defDie, dias: diasDie, distTrend: t.diesel_s10, spark: t.spark.diesel_s10 }),
    buildFuel({ nome: "🚛 Diesel S500", key: "diesel_s500", defasagem: defDie, dias: diasDie, distTrend: t.diesel_s500, spark: t.spark.diesel_s500 }),
    buildFuel({ nome: "🌱 Etanol",      key: "etanol",      defasagem: null,   dias: 0,       distTrend: t.etanol,     spark: t.spark.etanol, isEtanol: true }),
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
