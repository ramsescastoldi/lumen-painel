#!/usr/bin/env node
/**
 * decisao.mjs — Motor "Decisão do Dia" v3 (COMPRE AGORA / ATENÇÃO / PODE ESPERAR)
 *
 * Roda no GitHub Actions APÓS gerar-painel.mjs. Lê data.json (+ anp-historico.json
 * + history.json + Supabase opcional), calcula veredito determinístico por
 * combustível e grava `data.json.decisao`. 100% determinístico — ZERO IA na decisão.
 *
 * v3 (2026-06-10) — novos sinais e confiança:
 *   - Tendência ANP 4 semanas por produto (anp-historico.json): bomba repassando = pressão real
 *   - Brent variação 5 dias (history.json) com peso maior que a direção diária (ruído)
 *   - Spread refinarias privadas vs Petrobras (data.json.refinarias): mercado livre precificando acima
 *   - Sentimento de mídia do segmento últimos 5 dias (data.json.midia_setor, preenchido pelo Haiku)
 *   - mp_subsidio agora é DIRECIONAL: mp_subsidio_baixa (governo segurando preço → score cai)
 *     vs mp_subsidio_alta (subsídio expirando → risco de alta). Motivado pelo backtest:
 *     v2 mandava COMPRAR diesel dias antes do CORTE de 01/jun (mp_subsidio somava +14 sempre).
 *   - confianca_pct por fuel: convergência ponderada dos sinais (50–97). NUNCA 100 —
 *     reajuste Petrobras é decisão política; honestidade > marketing.
 *
 * Backtest qualitativo (4 eventos 2026): 29/mai gasolina +0,48 ✓ · 01/jun diesel -9,6%
 * ✓(v3; v2 errava) · 14/mar diesel +0,38 ✓ · 27/jan gasolina -5,2% ✓.
 *
 * Env:
 *   DATA_PATH        — default data.json
 *   ANP_HIST_PATH    — default anp-historico.json
 *   HISTORY_PATH     — default history.json
 *   SUPABASE_DB_URL  — opcional (custo distribuidora). Sem ela, modo degradado.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA_PATH = process.env.DATA_PATH || "data.json";
const ANP_PATH = process.env.ANP_HIST_PATH || "anp-historico.json";
const HIST_PATH = process.env.HISTORY_PATH || "history.json";
const SUPA = process.env.SUPABASE_DB_URL || "";

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

function pctNum(s) {
  if (s == null) return null;
  const m = String(s).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function rsNum(s) {
  if (s == null) return null;
  const m = String(s).replace(/[Rr]\$\s*/, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const ab = data.abicom || {};
const defGas = pctNum(ab.defasagem_gasolina_pct);
const defDie = pctNum(ab.defasagem_diesel_pct);
const diasGas = Number(ab.dias_sem_ajuste_gasolina) || 0;
const diasDie = Number(ab.dias_sem_ajuste_diesel) || 0;
const potGas = rsNum(ab.potencial_aumento_rs_gasolina);
const potDie = rsNum(ab.potencial_aumento_rs_diesel);
const brentDir = (data.petroleo?.brent?.dir || "flat").toLowerCase();
const usdDir = (data.moedas?.usdbrl?.dir || "flat").toLowerCase();

const mancheteTxt = (
  (data.manchete?.principal?.titulo || "") + " " +
  (data.manchete?.secundarias || []).map(s => s.titulo).join(" ") + " " +
  (data.resumo_editorial || "")
).toLowerCase();

// ---- Sinal regulatório/Petrobras — categorizado, agora com MP direcional ----
function classifyGovSignal() {
  const explicit = String(ab.sinal_petrobras || "").toLowerCase();
  if (explicit && explicit !== "nenhum") {
    // mp_subsidio sem direção explícita: infere pela manchete/resumo
    if (explicit === "mp_subsidio") {
      if (/(corte|cortou|reduz|baixar|baratear|neutralizar.*reonera|segurar.*pre[çc]o|conten[çc][ãa]o)/.test(mancheteTxt)) return "mp_subsidio_baixa";
      if (/(expira|vence|fim do subs[íi]dio|encerra.*subs[íi]dio|n[ãa]o.*renovar)/.test(mancheteTxt)) return "mp_subsidio_alta";
      return "mp_subsidio";
    }
    return explicit;
  }
  if (/reajustou|subiu.*pre[çc]o|aumentou.*pre[çc]o|petrobras.*aumenta|novo pre[çc]o.*entra/.test(mancheteTxt)) return "reajustou_recente";
  if (/n[ãa]o.*importar|n[ãa]o.*vai.*importar|janelas.*fechad|n[ãa]o importar[áa]/.test(mancheteTxt)) return "nao_importa";
  if (/medida provis[óo]ria|\bmp\b.*subsidio|\bmp\b.*cide|isen[çc][ãa]o.*pis|cide.*reduz/.test(mancheteTxt)) return "mp_subsidio";
  if (/reajuste.*iminente|anuncia.*reajuste|j[áa].*j[áa]|chambriard.*j[áa]|reajuste.*previsto/.test(mancheteTxt)) return "reajuste_anunciado";
  if (/reajust|petrobras|aumento.*combust|sobe.*combust/.test(mancheteTxt)) return "manchete_pressao";
  return "nenhum";
}
const govSignalType = classifyGovSignal();

// ---- ANP: tendência 4 semanas por produto (bomba repassando = pressão real) ----
function anpTrends() {
  const out = { gasolina: null, etanol: null, diesel_s10: null, diesel_s500: null, spark: {} };
  try {
    if (!existsSync(ANP_PATH)) return out;
    const hist = JSON.parse(readFileSync(ANP_PATH, "utf8"));
    for (const key of Object.keys(out)) {
      if (key === "spark") continue;
      const serie = (hist.produtos?.[key] || []);
      if (serie.length < 3) continue;
      const ult4 = serie.slice(-4);
      const first = ult4[0].p, last = ult4[ult4.length - 1].p;
      if (first > 0) out[key] = ((last - first) / first) * 100;
      out.spark[key] = serie.slice(-10).map(it => it.p);
    }
    console.log("✓ ANP histórico: tendências 4 semanas obtidas");
  } catch (e) { console.log("⚠️  anp-historico indisponível (" + e.message + ")"); }
  return out;
}
const anp = anpTrends();

// ---- Brent: variação 5 dias úteis (history.json) ----
function brent5d() {
  try {
    if (!existsSync(HIST_PATH)) return null;
    const h = JSON.parse(readFileSync(HIST_PATH, "utf8"));
    const serie = (h.dias || h.days || []).map(d => d.brent ?? d.indicadores?.brent).filter(v => v != null);
    if (serie.length < 2) return null;
    const win = serie.slice(-5);
    const first = Number(win[0]), last = Number(win[win.length - 1]);
    if (!isFinite(first) || !isFinite(last) || first <= 0) return null;
    return ((last - first) / first) * 100;
  } catch { return null; }
}
const brentVar5d = brent5d();

// ---- Refinarias privadas: spread % vs Petrobras (pressão estrutural) ----
function refinariasSpread() {
  const items = data.refinarias?.items || [];
  const petro = rsNum(items.find(i => /petrobras/i.test(i.nome || ""))?.preco_rs_l);
  if (!petro) return null;
  const privados = items.filter(i => !/petrobras/i.test(i.nome || ""))
    .map(i => rsNum(i.preco_rs_l)).filter(v => v != null && v > 0);
  if (!privados.length) return null;
  const media = privados.reduce((a, b) => a + b, 0) / privados.length;
  return ((media - petro) / petro) * 100;
}
const spreadPriv = refinariasSpread();

// ---- Mídia do segmento (últimos 5 dias) — preenchido pelo Haiku no data.json ----
const midia = data.midia_setor || null; // { sentimento: "pressao_alta"|"neutro"|"pressao_baixa", n_materias, resumo }
const midiaSent = String(midia?.sentimento || "").toLowerCase();

// ---- Supabase: tendência custo distribuidora (best-effort, igual v2) ----
async function supabaseTrends() {
  const out = { gasolina: null, diesel_s10: null, diesel_s500: null, etanol: null };
  if (!SUPA) { console.log("ℹ️  SUPABASE_DB_URL ausente — custo distribuidora indisponível"); return out; }
  let pg;
  try { pg = await import("pg"); } catch { console.log("⚠️  módulo pg indisponível"); return out; }
  const client = new pg.default.Client({ connectionString: SUPA, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const cols = (await client.query(
      `select column_name from information_schema.columns where table_name='precos_distribuicao_manual'`
    )).rows.map(r => r.column_name);
    const findCol = (re) => cols.find(c => re.test(c));
    const map = {
      gasolina: findCol(/gasolina/i),
      etanol: findCol(/etanol/i),
      diesel_s10: findCol(/diesel.*s.?10|s10/i),
      diesel_s500: findCol(/diesel.*s.?500|s500/i),
    };
    for (const [fuel, col] of Object.entries(map)) {
      if (!col) continue;
      const q = await client.query(
        `select data_coleta::date d, avg(nullif(${col},0)) v
           from precos_distribuicao_manual
          where ${col} is not null and ${col} > 0
          group by 1 order by 1 desc limit 12`
      );
      const rows = q.rows.map(r => ({ d: r.d, v: Number(r.v) })).filter(r => isFinite(r.v) && r.v > 0).reverse();
      if (rows.length >= 2) {
        const half = Math.max(1, Math.floor(rows.length / 2));
        const recent = rows.slice(-half).reduce((a, r) => a + r.v, 0) / half;
        const prev = rows.slice(0, half).reduce((a, r) => a + r.v, 0) / half;
        if (prev > 0) out[fuel] = ((recent - prev) / prev) * 100;
      }
    }
    console.log("✓ Supabase: tendências de custo distribuidora obtidas");
  } catch (e) {
    console.log("⚠️  Supabase falhou (" + e.message + ") — sem custo distribuidora");
  } finally {
    try { await client.end(); } catch {}
  }
  return out;
}

function sparkNormalize(arr) {
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

// ---- Motor v3 ----
function buildFuel({ nome, key, defasagem, dias, distTrend, potencialRs, anpTrend, spark, isEtanol }) {
  let score = 0;
  const reasons = [];
  // contabilidade de convergência: pesos up (pró-compra) e down (pró-espera)
  let wUp = 0, wDown = 0;
  const up = (w, dir, text) => { score += w; wUp += w; reasons.push({ dir, text }); };
  const down = (w, dir, text) => { score -= w; wDown += w; reasons.push({ dir, text }); };
  const flat = (text) => reasons.push({ dir: "flat", text });
  const fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",");

  // COOLDOWN: Petrobras reajustou recentemente → pressão zerada
  if (govSignalType === "reajustou_recente") {
    score = 8;
    reasons.push({ dir: "down", text: "Petrobras reajustou recentemente — pressão zerada por enquanto" });
    if (distTrend != null && distTrend <= -1) reasons.push({ dir: "down", text: `Custo distribuidora <b>${fmt(distTrend)}%</b> (caindo)` });
    if (anpTrend != null && anpTrend <= -0.5) reasons.push({ dir: "down", text: `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> nas últimas 4 semanas` });
    const f = finalize(key, nome, score, reasons, spark);
    f.confianca_pct = 90; // cooldown é o sinal mais confiável do modelo
    return f;
  }

  // 1. POTENCIAL R$/L (ABICOM)
  if (!isEtanol && potencialRs != null && potencialRs > 0) {
    if (potencialRs >= 1.0) up(40, "up", `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> pra alcançar paridade (ABICOM)`);
    else if (potencialRs >= 0.5) up(25, "up", `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (zona de atenção)`);
    else if (potencialRs >= 0.2) up(10, "flat", `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (baixo)`);
  }

  // 2. DEFASAGEM %
  if (!isEtanol && defasagem != null) {
    if (defasagem >= 80) up(50, "up", `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (histórica)`);
    else if (defasagem >= 60) up(38, "up", `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (crítica)`);
    else if (defasagem >= 40) up(28, "up", `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (alta)`);
    else if (defasagem >= 25) up(16, "up", `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (zona de atenção)`);
    else if (defasagem >= 10) up(6, "flat", `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (baixa)`);
    else if (defasagem < 0) down(8, "down", `Defasagem <b>${defasagem.toFixed(0)}%</b> (Petrobras acima da paridade)`);
  }

  // 3. DIAS SEM REAJUSTE
  if (!isEtanol && dias > 0) {
    if (dias >= 90) up(28, "up", `<b>${dias} dias</b> sem reajuste (pressão acumulada)`);
    else if (dias >= 60) up(20, "up", `<b>${dias} dias</b> sem reajuste`);
    else if (dias >= 40) up(12, "up", `<b>${dias} dias</b> sem reajuste`);
    else if (dias >= 20) up(5, "flat", `<b>${dias} dias</b> sem reajuste`);
  }

  // 4. SINERGIA defasagem × dias
  if (!isEtanol && defasagem != null && dias > 0) {
    if (defasagem >= 60 && dias >= 90) up(12, "up", `Sinergia: defasagem crítica + meses sem reajuste = pressão máxima`);
    else if (defasagem >= 40 && dias >= 60) up(8, "up", `Sinergia: defasagem alta + dias acumulados`);
  }

  // 5. CUSTO DISTRIBUIDORA (peso maior pro etanol)
  if (distTrend != null) {
    const wMul = isEtanol ? 1.4 : 1.0;
    if (distTrend >= 5) up(Math.round(25 * wMul), "up", `Custo distribuidora <b>${fmt(distTrend)}%</b> (subindo forte)`);
    else if (distTrend >= 3) up(Math.round(18 * wMul), "up", `Custo distribuidora <b>${fmt(distTrend)}%</b> nas últimas 2 semanas`);
    else if (distTrend >= 1) up(Math.round(8 * wMul), "up", `Custo distribuidora <b>${fmt(distTrend)}%</b> (leve)`);
    else if (distTrend <= -2) down(Math.round(12 * wMul), "down", `Custo distribuidora <b>${fmt(distTrend)}%</b> (caindo)`);
    else if (distTrend <= -0.5) down(5, "down", `Custo distribuidora <b>${fmt(distTrend)}%</b> (queda leve)`);
    else flat(`Custo distribuidora estável (${fmt(distTrend)}%)`);
  }

  // 6. TENDÊNCIA ANP 4 SEMANAS (novo v3) — bomba repassando = pressão confirmada na ponta
  if (anpTrend != null) {
    if (anpTrend >= 2) up(12, "up", `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas — mercado já repassando`);
    else if (anpTrend >= 0.8) up(6, "up", `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (leve alta)`);
    else if (anpTrend <= -2) down(10, "down", `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (caindo)`);
    else if (anpTrend <= -0.8) down(5, "down", `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (queda leve)`);
  }

  // 7. MACRO — Brent 5 dias pesa mais que a direção diária (ruído)
  if (brentVar5d != null) {
    if (brentVar5d >= 8) up(15, "up", `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias — pressão forte no custo de reposição`);
    else if (brentVar5d >= 4) up(8, "up", `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias`);
    else if (brentVar5d <= -8) down(12, "down", `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias — alívio relevante`);
    else if (brentVar5d <= -4) down(6, "down", `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias (alívio)`);
  }
  if (brentDir === "up") up(6, "up", `Brent subindo hoje`);
  else if (brentDir === "down") down(3, "down", `Brent em queda hoje`);
  if (usdDir === "up") up(8, "up", `Dólar subindo — encarece importação`);
  else if (usdDir === "down") down(4, "down", `Dólar em queda — alivia importação`);

  // 8. SPREAD REFINARIAS PRIVADAS (novo v3) — mercado livre precificando bem acima
  if (!isEtanol && spreadPriv != null) {
    if (spreadPriv >= 60) up(8, "up", `Refinarias privadas <b>${fmt(spreadPriv)}%</b> acima da Petrobras — preço estatal artificialmente baixo`);
    else if (spreadPriv >= 30) up(4, "flat", `Refinarias privadas ${fmt(spreadPriv)}% acima da Petrobras`);
  }

  // 9. MÍDIA DO SEGMENTO 5 DIAS (novo v3)
  if (midiaSent === "pressao_alta") up(14, "up", `Mídia do setor (5 dias): <b>pressão de alta</b>${midia?.n_materias ? ` em ${midia.n_materias} matérias` : ""}`);
  else if (midiaSent === "pressao_baixa") down(14, "down", `Mídia do setor (5 dias): <b>expectativa de queda/alívio</b>${midia?.n_materias ? ` em ${midia.n_materias} matérias` : ""}`);
  else if (midiaSent === "neutro") flat(`Mídia do setor (5 dias): sem direção clara`);

  // 10. SINAL REGULATÓRIO (v3: mp_subsidio direcional)
  if (govSignalType === "reajuste_anunciado") up(18, "up", `Petrobras anunciou reajuste iminente`);
  else if (govSignalType === "mp_subsidio_alta") up(16, "up", `Subsídio perto de expirar — risco de alta na sequência`);
  else if (govSignalType === "mp_subsidio_baixa") down(20, "down", `Governo ativamente segurando/baixando preço (MP de subvenção) — pressão de alta contida`);
  else if (govSignalType === "mp_subsidio") up(4, "flat", `MP/subsídio vigente — direção indefinida`);
  else if (govSignalType === "nao_importa") up(10, "up", `Petrobras sem importar — defasagem deve persistir`);
  else if (govSignalType === "manchete_pressao") up(6, "up", `Sinal de pressão na manchete`);

  // 11. ETANOL — mandato anidro
  if (isEtanol) {
    const anidroPct = pctNum(data.mandatos?.anidro_na_gasolina_pct);
    if (anidroPct != null && anidroPct >= 30) { score += 5; wUp += 5; reasons.push({ dir: "flat", text: `Mandato anidro em <b>${anidroPct}%</b> — consumo estrutural elevado` }); }
    if (reasons.length === 0) flat(`Sem pressão de alta detectada — giro normal de estoque`);
  }

  const f = finalize(key, nome, score, reasons, spark);
  // Confiança = convergência ponderada dos sinais (50–97)
  const total = wUp + wDown;
  if (total > 0) {
    const dominancia = Math.max(wUp, wDown) / total; // 0.5..1
    f.confianca_pct = Math.min(97, Math.round(50 + (dominancia - 0.5) * 2 * 47));
  } else {
    f.confianca_pct = 50;
  }
  return f;
}

function finalize(key, nome, score, reasons, spark) {
  score = Math.max(0, Math.min(100, Math.round(score)));
  const v = verdict(score);
  const ord = { up: 0, down: 1, flat: 2 };
  reasons.sort((a, b) => (ord[a.dir] ?? 9) - (ord[b.dir] ?? 9));
  return {
    key, nome,
    verdict: v.verdict, label: v.label, emoji: v.emoji, score,
    spark: sparkNormalize(spark) || [],
    reasons: reasons.slice(0, 6)
  };
}

(async () => {
  const t = await supabaseTrends();

  const fuels = [
    buildFuel({ nome: "⛽ Gasolina",   key: "gasolina",    defasagem: defGas, dias: diasGas, distTrend: t.gasolina,    potencialRs: potGas, anpTrend: anp.gasolina,    spark: anp.spark.gasolina }),
    buildFuel({ nome: "🚚 Diesel S10",  key: "diesel_s10",  defasagem: defDie, dias: diasDie, distTrend: t.diesel_s10,  potencialRs: potDie, anpTrend: anp.diesel_s10,  spark: anp.spark.diesel_s10 }),
    buildFuel({ nome: "🚛 Diesel S500", key: "diesel_s500", defasagem: defDie, dias: diasDie, distTrend: t.diesel_s500, potencialRs: potDie, anpTrend: anp.diesel_s500, spark: anp.spark.diesel_s500 }),
    buildFuel({ nome: "🌱 Etanol",      key: "etanol",      defasagem: null,   dias: 0,       distTrend: t.etanol,      potencialRs: null,   anpTrend: anp.etanol,      spark: anp.spark.etanol, isEtanol: true }),
  ];

  data.decisao = {
    data_label: data.meta?.date_label || "",
    base: "ABICOM + ANP histórico + Brent 5d + refinarias + mídia do setor" + (SUPA ? " + custo distribuidora" : ""),
    disclaimer: "Essa não é uma recomendação de compra, apenas uma sugestão baseada num modelo educacional. A confiança reflete a convergência dos sinais — reajustes da Petrobras têm componente político imprevisível.",
    fuels
  };

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log("✓ Decisão do Dia v3 gravada em " + DATA_PATH);
  for (const f of fuels) console.log(`  ${f.emoji} ${f.nome}: ${f.label} (${f.score}/100, confiança ${f.confianca_pct}%)`);
  process.exit(0);
})();
