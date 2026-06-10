#!/usr/bin/env node
/**
 * decisao.mjs — Motor "Decisão do Dia" v4 (COMPRE AGORA / ATENÇÃO / PODE ESPERAR)
 *
 * Roda no GitHub Actions APÓS gerar-painel.mjs. Lê data.json (+ anp-historico.json
 * + history.json + Supabase opcional), calcula veredito determinístico por
 * combustível e grava `data.json.decisao`. 100% determinístico — ZERO IA na decisão.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * v4 (2026-06-10) — pedido do Ramsés: "sempre analise se a decisão de compra faz
 * sentido diante do cenário (barril, defasagem, mídia, pressão de repasse das
 * distribuidoras). Quanto ao Etanol, a correlação é SAFRA, ESALQ, safra milho e
 * mídia." Duas mudanças estruturais:
 *
 *  1. ETANOL TEM MOTOR PRÓPRIO. Combustível fóssil é puxado por barril/defasagem/
 *     paridade de importação — etanol NÃO. Etanol é commodity agrícola: preço é
 *     ditado por (a) ciclo de safra cana Centro-Sul, (b) ESALQ/CEPEA hidratado,
 *     (c) oferta de etanol de milho (safra milho CW), (d) mídia do setor sucro.
 *     buildEtanol() ignora Brent, ABICOM e refinarias — usa só esses 4 eixos.
 *
 *  2. CAMADA DE COERÊNCIA. Cada fuel ganha `cenario` com os fatores-chave e suas
 *     direções, mais uma linha `resumo` que diz se o veredito FAZ SENTIDO. Se a
 *     soma dos sinais contradiz o score (raro, mas possível em transição), loga
 *     ⚠️ INCOERÊNCIA pra revisão. Implementa o "sempre analise se faz sentido".
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Env: DATA_PATH, ANP_HIST_PATH, HISTORY_PATH, SUPABASE_DB_URL (opcional)
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
function fmt(v) { return (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ","); }

const ab = data.abicom || {};
const defGas = pctNum(ab.defasagem_gasolina_pct);
const defDie = pctNum(ab.defasagem_diesel_pct);
const diasGas = Number(ab.dias_sem_ajuste_gasolina) || 0;
const diasDie = Number(ab.dias_sem_ajuste_diesel) || 0;
const potGas = rsNum(ab.potencial_aumento_rs_gasolina);
const potDie = rsNum(ab.potencial_aumento_rs_diesel);
const brentDir = (data.petroleo?.brent?.dir || "flat").toLowerCase();
const usdDir = (data.moedas?.usdbrl?.dir || "flat").toLowerCase();
const mesNum = Number((data.meta?.date_iso || "").slice(5, 7)) || (new Date().getUTCMonth() + 1);

const mancheteTxt = (
  (data.manchete?.principal?.titulo || "") + " " +
  (data.manchete?.secundarias || []).map(s => s.titulo).join(" ") + " " +
  (data.resumo_editorial || "")
).toLowerCase();

// ---- Sinal regulatório/Petrobras (só fóssil) — MP direcional ----
function classifyGovSignal() {
  const explicit = String(ab.sinal_petrobras || "").toLowerCase();
  if (explicit && explicit !== "nenhum") {
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
  if (/reajuste.*iminente|anuncia.*reajuste|chambriard.*j[áa]|reajuste.*previsto/.test(mancheteTxt)) return "reajuste_anunciado";
  if (/reajust|petrobras|aumento.*combust|sobe.*combust/.test(mancheteTxt)) return "manchete_pressao";
  return "nenhum";
}
const govSignalType = classifyGovSignal();

// ---- ANP: tendência 4 semanas por produto (repasse na bomba) ----
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
    const serie = (h.days || []).map(d => d.brent).filter(v => v != null);
    if (serie.length < 2) return null;
    const win = serie.slice(-5);
    const first = Number(win[0]), last = Number(win[win.length - 1]);
    if (!isFinite(first) || !isFinite(last) || first <= 0) return null;
    return ((last - first) / first) * 100;
  } catch { return null; }
}
const brentVar5d = brent5d();

// ---- CEPEA/ESALQ hidratado: tendência com fallback robusto pra ANP etanol ----
// Só confia no history.cepea_hid se for (a) recente (último ponto ≤10 dias),
// (b) com variação real (min≠max — evita série stale de valores idênticos) e
// (c) plausível (R$ 1,5–6/L). Caso contrário usa ANP etanol revenda como proxy.
// Motivado por bug 10/jun: history tinha 5x 1,3746 stale de maio → trend falso 0%.
function cepeaTrend() {
  try {
    if (existsSync(HIST_PATH)) {
      const h = JSON.parse(readFileSync(HIST_PATH, "utf8"));
      const pts = (h.days || []).filter(d => d.cepea_hid != null && d.cepea_hid >= 1.5 && d.cepea_hid <= 6);
      const hoje = data.meta?.date_iso || "";
      const ultimo = pts.at(-1);
      const recente = ultimo && hoje && ((Date.parse(hoje) - Date.parse(ultimo.date)) / 86400000) <= 10;
      const vals = pts.map(d => Number(d.cepea_hid));
      const variou = vals.length >= 3 && Math.min(...vals) !== Math.max(...vals);
      if (recente && variou) {
        const first = vals[0], last = vals[vals.length - 1];
        if (first > 0) return { pct: ((last - first) / first) * 100, fonte: "CEPEA/ESALQ" };
      }
    }
  } catch {}
  if (anp.etanol != null) return { pct: anp.etanol, fonte: "ANP revenda (proxy ESALQ)" };
  return null;
}
const cepea = cepeaTrend();

// ---- Spread refinarias privadas vs Petrobras (só fóssil) ----
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

// ---- Mídias do setor (preenchidas pelo Haiku) ----
const midiaFossil = String(data.midia_setor?.sentimento || "").toLowerCase();
const midiaEtanol = String(data.midia_etanol?.sentimento || "").toLowerCase();

// ---- Safra cana: ciclo sazonal Centro-Sul + dados moagem/mix ----
// Colheita Abr–Nov (pico Jun–Set = oferta abundante → preço cede).
// Entressafra Dez–Mar = oferta apertada → preço sobe.
const safra = data.safra_etanol || {};
const mixEtanol = pctNum(safra.mix_etanol_pct);       // % do caldo destinado a etanol
const moagemVar = pctNum(safra.var_anual);            // var % moagem a/a
// ---- Safra milho (etanol de milho amortece oferta) ----
const milho = data.safra_milho || {};
const milhoSent = String(milho.tendencia || "").toLowerCase(); // alta_oferta | normal | baixa_oferta

function verdict(score) {
  if (score >= 65) return { verdict: "buy",  label: "COMPRE AGORA", emoji: "🔴" };
  if (score >= 35) return { verdict: "warn", label: "ATENÇÃO",      emoji: "🟡" };
  return                 { verdict: "wait", label: "PODE ESPERAR",  emoji: "🟢" };
}
function sparkNormalize(arr) {
  if (!arr || arr.length < 2) return null;
  const a = arr.slice(-10);
  const mn = Math.min(...a), mx = Math.max(...a);
  const span = mx - mn || 1;
  return a.map(v => Math.round(8 + ((v - mn) / span) * 92));
}

// ════════ Supabase: custo distribuidora (best-effort) ════════
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
    const map = { gasolina: findCol(/gasolina/i), etanol: findCol(/etanol/i),
      diesel_s10: findCol(/diesel.*s.?10|s10/i), diesel_s500: findCol(/diesel.*s.?500|s500/i) };
    for (const [fuel, col] of Object.entries(map)) {
      if (!col) continue;
      const q = await client.query(
        `select data_coleta::date d, avg(nullif(${col},0)) v from precos_distribuicao_manual
          where ${col} is not null and ${col} > 0 group by 1 order by 1 desc limit 12`);
      const rows = q.rows.map(r => ({ d: r.d, v: Number(r.v) })).filter(r => isFinite(r.v) && r.v > 0).reverse();
      if (rows.length >= 2) {
        const half = Math.max(1, Math.floor(rows.length / 2));
        const recent = rows.slice(-half).reduce((a, r) => a + r.v, 0) / half;
        const prev = rows.slice(0, half).reduce((a, r) => a + r.v, 0) / half;
        if (prev > 0) out[fuel] = ((recent - prev) / prev) * 100;
      }
    }
    console.log("✓ Supabase: tendências de custo distribuidora obtidas");
  } catch (e) { console.log("⚠️  Supabase falhou (" + e.message + ")"); }
  finally { try { await client.end(); } catch {} }
  return out;
}

// helper de cenário: acumula fatores nomeados + direção pra camada de coerência
function makeBuilder() {
  let score = 0, wUp = 0, wDown = 0;
  const reasons = [];
  const cenario = [];
  const add = (w, dir, text, fator) => {
    score += (dir === "down" ? -w : dir === "up" ? w : 0);
    if (dir === "up") wUp += w; else if (dir === "down") wDown += w;
    reasons.push({ dir, text });
    if (fator) cenario.push({ nome: fator, dir, txt: text.replace(/<[^>]+>/g, "") });
  };
  return {
    up: (w, t, f) => add(w, "up", t, f),
    down: (w, t, f) => add(w, "down", t, f),
    flat: (t, f) => add(0, "flat", t, f),
    get score() { return score; }, get wUp() { return wUp; }, get wDown() { return wDown; },
    reasons, cenario,
  };
}

function finalize(key, nome, b, spark) {
  const sc = Math.max(0, Math.min(100, Math.round(b.score)));
  const v = verdict(sc);
  const ord = { up: 0, down: 1, flat: 2 };
  b.reasons.sort((a, z) => (ord[a.dir] ?? 9) - (ord[z.dir] ?? 9));
  // confiança = convergência ponderada (50–97). Reajuste/safra têm imprevisível
  // componente externo, então nunca 100.
  const total = b.wUp + b.wDown;
  const conf = total > 0 ? Math.min(97, Math.round(50 + (Math.max(b.wUp, b.wDown) / total - 0.5) * 2 * 47)) : 50;
  // coerência: o veredito bate com a direção dominante do cenário?
  const dirVerd = v.verdict === "buy" ? "up" : v.verdict === "wait" ? "down" : "mixed";
  const dirCenario = b.wUp > b.wDown * 1.15 ? "up" : b.wDown > b.wUp * 1.15 ? "down" : "mixed";
  const coerente = dirVerd === "mixed" || dirCenario === "mixed" || dirVerd === dirCenario;
  if (!coerente) console.log(`⚠️  INCOERÊNCIA ${key}: veredito ${v.label} mas cenário aponta ${dirCenario} (up ${b.wUp} / down ${b.wDown}). Revisar.`);
  const resumo = b.cenario.map(c => `${c.nome} ${c.dir === "up" ? "↑" : c.dir === "down" ? "↓" : "•"}`).join(" · ")
    + ` → faz sentido ${v.verdict === "buy" ? "COMPRAR" : v.verdict === "warn" ? "ATENÇÃO" : "ESPERAR"}`;
  return {
    key, nome, verdict: v.verdict, label: v.label, emoji: v.emoji, score: sc,
    confianca_pct: conf,
    cenario: { resumo, coerente, fatores: b.cenario.slice(0, 4) },
    spark: sparkNormalize(spark) || [],
    reasons: b.reasons.slice(0, 6),
  };
}

// ════════ FÓSSIL: barril + defasagem + mídia + repasse distribuidoras ════════
function buildFossil({ nome, key, defasagem, dias, distTrend, potencialRs, anpTrend, spark }) {
  const b = makeBuilder();

  // COOLDOWN: Petrobras reajustou recentemente → pressão de alta zerada.
  // Override deliberado: mesmo com defasagem alta, não há janela pra novo
  // reajuste no curto prazo. Mostra os eixos como CONTEXTO mas o veredito é ESPERAR.
  if (govSignalType === "reajustou_recente") {
    const reasons = [{ dir: "down", text: "Petrobras reajustou recentemente — sem janela pra novo reajuste no curto prazo" }];
    const cen = [{ nome: "Reajuste recente", dir: "down", txt: "Petrobras já se mexeu — cooldown" }];
    // contexto: defasagem residual + barril, sem alterar o veredito
    if (defasagem != null) { cen.push({ nome: "Defasagem", dir: defasagem >= 40 ? "up" : "flat", txt: `${defasagem.toFixed(0)}%${dias ? ` / ${dias}d` : ""} (residual)` });
      reasons.push({ dir: defasagem >= 40 ? "up" : "flat", text: `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> ainda existe, mas reajuste recente segura novo movimento` }); }
    if (brentVar5d != null) cen.push({ nome: "Barril", dir: brentVar5d <= -4 ? "down" : brentVar5d >= 4 ? "up" : "flat", txt: `Brent ${fmt(brentVar5d)}% em 5d` });
    if (anpTrend != null && anpTrend <= -0.8) reasons.push({ dir: "down", text: `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas — sem repasse de alta` });
    const resumo = cen.map(c => `${c.nome} ${c.dir === "up" ? "↑" : c.dir === "down" ? "↓" : "•"}`).join(" · ") + " → faz sentido ESPERAR";
    return { key, nome, verdict: "wait", label: "PODE ESPERAR", emoji: "🟢", score: 8, confianca_pct: 90,
      cenario: { resumo, coerente: true, fatores: cen.slice(0, 4) },
      spark: sparkNormalize(spark) || [], reasons: reasons.slice(0, 6) };
  }

  // EIXO 1 — DEFASAGEM (núcleo do reajuste fóssil)
  eixoDefasagem(b, defasagem, dias, potencialRs);
  // sinergia
  if (defasagem != null && dias > 0) {
    if (defasagem >= 60 && dias >= 90) b.up(12, "Sinergia: defasagem crítica + meses sem reajuste = pressão máxima");
    else if (defasagem >= 40 && dias >= 60) b.up(8, "Sinergia: defasagem alta + dias acumulados");
  }
  // EIXO 2 — BARRIL
  eixoBarril(b);
  // EIXO 3 — MÍDIA
  eixoMidiaFossil(b);
  // EIXO 4 — REPASSE DISTRIBUIDORAS (ANP bomba + custo distribuidora + spread privadas)
  eixoRepasse(b, anpTrend, distTrend);
  if (spreadPriv != null) {
    if (spreadPriv >= 60) b.up(8, `Refinarias privadas <b>${fmt(spreadPriv)}%</b> acima da Petrobras — preço estatal artificialmente baixo`);
    else if (spreadPriv >= 30) b.flat(`Refinarias privadas ${fmt(spreadPriv)}% acima da Petrobras`);
  }
  // SINAL REGULATÓRIO
  if (govSignalType === "reajuste_anunciado") b.up(18, "Petrobras anunciou reajuste iminente", "Petrobras");
  else if (govSignalType === "mp_subsidio_alta") b.up(16, "Subsídio perto de expirar — risco de alta na sequência", "Governo");
  else if (govSignalType === "mp_subsidio_baixa") b.down(20, "Governo segurando/baixando preço (MP de subvenção) — pressão de alta contida", "Governo");
  else if (govSignalType === "mp_subsidio") b.flat("MP/subsídio vigente — direção indefinida", "Governo");
  else if (govSignalType === "nao_importa") b.up(10, "Petrobras sem importar — defasagem deve persistir", "Petrobras");
  else if (govSignalType === "manchete_pressao") b.up(6, "Sinal de pressão na manchete");

  return finalize(key, nome, b, spark);
}
function eixoDefasagem(b, defasagem, dias, potencialRs) {
  let txt = "sem dado";
  if (potencialRs != null && potencialRs > 0) {
    if (potencialRs >= 1.0) b.up(40, `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> pra alcançar paridade (ABICOM)`);
    else if (potencialRs >= 0.5) b.up(25, `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (zona de atenção)`);
    else if (potencialRs >= 0.2) b.up(10, `Potencial de aumento <b>R$ ${potencialRs.toFixed(2).replace(".", ",")}/L</b> (baixo)`);
  }
  if (defasagem != null) {
    if (defasagem >= 80) b.up(50, `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (histórica)`);
    else if (defasagem >= 60) b.up(38, `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (crítica)`);
    else if (defasagem >= 40) b.up(28, `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (alta)`);
    else if (defasagem >= 25) b.up(16, `Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (zona de atenção)`);
    else if (defasagem >= 10) b.flat(`Defasagem ABICOM <b>${defasagem.toFixed(0)}%</b> (baixa)`);
    else if (defasagem < 0) b.down(8, `Defasagem <b>${defasagem.toFixed(0)}%</b> (Petrobras acima da paridade)`);
    txt = `${defasagem.toFixed(0)}%` + (dias > 0 ? ` / ${dias}d` : "");
  }
  if (dias > 0) {
    if (dias >= 90) b.up(28, `<b>${dias} dias</b> sem reajuste (pressão acumulada)`);
    else if (dias >= 60) b.up(20, `<b>${dias} dias</b> sem reajuste`);
    else if (dias >= 40) b.up(12, `<b>${dias} dias</b> sem reajuste`);
    else if (dias >= 20) b.flat(`<b>${dias} dias</b> sem reajuste`);
  }
  // registra eixo no cenário (direção = sinal líquido da defasagem)
  const dir = (defasagem != null && defasagem >= 40) ? "up" : (defasagem != null && defasagem < 10) ? "down" : "flat";
  b.cenario.push({ nome: "Defasagem", dir, txt });
}
function eixoBarril(b) {
  let dir = "flat", txt = "estável";
  if (brentVar5d != null) {
    if (brentVar5d >= 8) { b.up(15, `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias — pressão forte no custo de reposição`); dir = "up"; }
    else if (brentVar5d >= 4) { b.up(8, `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias`); dir = "up"; }
    else if (brentVar5d <= -8) { b.down(12, `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias — alívio relevante`); dir = "down"; }
    else if (brentVar5d <= -4) { b.down(6, `Brent <b>${fmt(brentVar5d)}%</b> em 5 dias (alívio)`); dir = "down"; }
    txt = `Brent ${fmt(brentVar5d)}% em 5d`;
  } else {
    if (brentDir === "up") { b.up(6, "Brent subindo hoje"); dir = "up"; }
    else if (brentDir === "down") { b.down(3, "Brent em queda hoje"); dir = "down"; }
    txt = `Brent ${brentDir === "up" ? "↑" : brentDir === "down" ? "↓" : "estável"} hoje`;
  }
  if (usdDir === "up") b.up(8, "Dólar subindo — encarece importação");
  else if (usdDir === "down") b.down(4, "Dólar em queda — alivia importação");
  b.cenario.push({ nome: "Barril", dir, txt });
}
function eixoMidiaFossil(b) {
  let dir = "flat", txt = "sem cobertura relevante";
  if (midiaFossil === "pressao_alta") { b.up(14, `Mídia do setor (5 dias): <b>pressão de alta</b>${data.midia_setor?.n_materias ? ` em ${data.midia_setor.n_materias} matérias` : ""}`); dir = "up"; txt = "pressão de alta"; }
  else if (midiaFossil === "pressao_baixa") { b.down(14, `Mídia do setor (5 dias): <b>expectativa de queda/alívio</b>`); dir = "down"; txt = "expectativa de queda"; }
  else if (midiaFossil === "neutro") { b.flat("Mídia do setor (5 dias): sem direção clara"); txt = "neutra"; }
  b.cenario.push({ nome: "Mídia", dir, txt });
}
function eixoRepasse(b, anpTrend, distTrend) {
  let dir = "flat", txt = "estável";
  if (anpTrend != null) {
    if (anpTrend >= 2) { b.up(12, `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas — mercado já repassando`); dir = "up"; }
    else if (anpTrend >= 0.8) { b.up(6, `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (leve alta)`); dir = "up"; }
    else if (anpTrend <= -2) { b.down(10, `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (caindo)`); dir = "down"; }
    else if (anpTrend <= -0.8) { b.down(5, `Preço de bomba ANP <b>${fmt(anpTrend)}%</b> em 4 semanas (queda leve)`); dir = "down"; }
    txt = `ANP bomba ${fmt(anpTrend)}% em 4sem`;
  }
  if (distTrend != null) {
    if (distTrend >= 5) b.up(25, `Custo distribuidora <b>${fmt(distTrend)}%</b> (subindo forte)`);
    else if (distTrend >= 3) b.up(18, `Custo distribuidora <b>${fmt(distTrend)}%</b> nas últimas 2 semanas`);
    else if (distTrend >= 1) b.up(8, `Custo distribuidora <b>${fmt(distTrend)}%</b> (leve)`);
    else if (distTrend <= -2) b.down(12, `Custo distribuidora <b>${fmt(distTrend)}%</b> (caindo)`);
    else if (distTrend <= -0.5) b.down(5, `Custo distribuidora <b>${fmt(distTrend)}%</b> (queda leve)`);
    if (txt === "estável") txt = `dist ${fmt(distTrend)}%`;
  }
  b.cenario.push({ nome: "Repasse distrib.", dir, txt });
}

// ════════ ETANOL: safra + ESALQ + safra milho + mídia ════════
function buildEtanol({ key, nome, distTrend, spark }) {
  const b = makeBuilder();

  // EIXO 1 — SAFRA CANA (ciclo sazonal Centro-Sul + moagem + mix)
  let safraDir = "flat", safraTxt = "transição";
  if (mesNum === 12 || mesNum <= 3) { b.up(22, "Entressafra (dez–mar) — oferta de cana apertada, etanol tende a subir"); safraDir = "up"; safraTxt = "entressafra (oferta apertada)"; }
  else if (mesNum >= 6 && mesNum <= 9) { b.down(20, "Pico de safra (jun–set) — oferta abundante de cana, etanol cede"); safraDir = "down"; safraTxt = "pico de safra (oferta alta)"; }
  else if (mesNum === 4 || mesNum === 5) { b.flat("Início de safra (abr–mai) — oferta crescente"); safraTxt = "início de safra"; }
  else if (mesNum === 10 || mesNum === 11) { b.up(8, "Fim de safra (out–nov) — oferta começa a apertar"); safraDir = "up"; safraTxt = "fim de safra"; }
  // mix: caldo pra etanol vs açúcar
  if (mixEtanol != null) {
    if (mixEtanol < 46) b.up(10, `Mix em <b>${mixEtanol.toFixed(0)}%</b> p/ etanol — usinas priorizando açúcar, menos etanol disponível`);
    else if (mixEtanol > 55) b.down(8, `Mix em <b>${mixEtanol.toFixed(0)}%</b> p/ etanol — oferta alta de etanol`);
    else b.flat(`Mix em <b>${mixEtanol.toFixed(0)}%</b> p/ etanol (equilibrado)`);
  }
  // moagem a/a: safra menor = menos oferta = up
  if (moagemVar != null) {
    if (moagemVar <= -5) b.up(8, `Moagem <b>${fmt(moagemVar)}%</b> a/a — safra menor reduz oferta`);
    else if (moagemVar >= 5) b.down(6, `Moagem <b>${fmt(moagemVar)}%</b> a/a — safra maior amplia oferta`);
  }
  b.cenario.push({ nome: "Safra cana", dir: safraDir, txt: safraTxt });

  // EIXO 2 — ESALQ/CEPEA hidratado
  let esalqDir = "flat", esalqTxt = "estável";
  if (cepea != null) {
    const p = cepea.pct;
    if (p >= 3) { b.up(20, `ESALQ/CEPEA hidratado <b>${fmt(p)}%</b> (${cepea.fonte}) — produtor subindo forte`); esalqDir = "up"; }
    else if (p >= 1) { b.up(10, `ESALQ/CEPEA hidratado <b>${fmt(p)}%</b> (${cepea.fonte})`); esalqDir = "up"; }
    else if (p <= -3) { b.down(18, `ESALQ/CEPEA hidratado <b>${fmt(p)}%</b> (${cepea.fonte}) — produtor cedendo`); esalqDir = "down"; }
    else if (p <= -1) { b.down(9, `ESALQ/CEPEA hidratado <b>${fmt(p)}%</b> (${cepea.fonte})`); esalqDir = "down"; }
    else b.flat(`ESALQ/CEPEA hidratado estável (${fmt(p)}%, ${cepea.fonte})`);
    esalqTxt = `${fmt(p)}%`;
  }
  b.cenario.push({ nome: "ESALQ", dir: esalqDir, txt: esalqTxt });

  // EIXO 3 — SAFRA MILHO (etanol de milho amortece a oferta total)
  let milhoDir = "flat", milhoTxt = "sem dado";
  if (milhoSent === "alta_oferta") { b.down(10, `Safra de milho com alta oferta — etanol de milho amortece preços${milho.nota ? ` (${milho.nota})` : ""}`); milhoDir = "down"; milhoTxt = "alta oferta"; }
  else if (milhoSent === "baixa_oferta") { b.up(10, `Safra de milho apertada — menos etanol de milho, pressão de alta${milho.nota ? ` (${milho.nota})` : ""}`); milhoDir = "up"; milhoTxt = "oferta apertada"; }
  else if (milhoSent === "normal") { b.flat("Safra de milho em ritmo normal — etanol de milho estável"); milhoTxt = "normal"; }
  b.cenario.push({ nome: "Safra milho", dir: milhoDir, txt: milhoTxt });

  // EIXO 4 — MÍDIA ETANOL/SUCRO
  let midDir = "flat", midTxt = "sem cobertura";
  if (midiaEtanol === "pressao_alta") { b.up(14, `Mídia sucroenergética (5 dias): <b>pressão de alta</b>${data.midia_etanol?.n_materias ? ` em ${data.midia_etanol.n_materias} matérias` : ""}`); midDir = "up"; midTxt = "pressão de alta"; }
  else if (midiaEtanol === "pressao_baixa") { b.down(14, `Mídia sucroenergética (5 dias): <b>expectativa de queda</b>`); midDir = "down"; midTxt = "expectativa de queda"; }
  else if (midiaEtanol === "neutro") { b.flat("Mídia sucroenergética (5 dias): sem direção clara"); midTxt = "neutra"; }
  b.cenario.push({ nome: "Mídia", dir: midDir, txt: midTxt });

  // custo distribuidora (sinal de mercado, peso menor — confirma direção)
  if (distTrend != null) {
    if (distTrend >= 3) b.up(8, `Custo distribuidora etanol <b>${fmt(distTrend)}%</b> (subindo)`);
    else if (distTrend <= -3) b.down(8, `Custo distribuidora etanol <b>${fmt(distTrend)}%</b> (caindo)`);
  }
  // mandato anidro (consumo estrutural — piso de demanda)
  const anidroPct = pctNum(data.mandatos?.anidro_na_gasolina_pct);
  if (anidroPct != null && anidroPct >= 30) b.flat(`Mandato anidro em <b>${anidroPct}%</b> — consumo estrutural sustenta demanda`);

  if (b.reasons.length === 0) b.flat("Sem pressão definida — giro normal de estoque");
  return finalize(key, nome, b, spark);
}

(async () => {
  const t = await supabaseTrends();
  const fuels = [
    buildFossil({ nome: "⛽ Gasolina",   key: "gasolina",    defasagem: defGas, dias: diasGas, distTrend: t.gasolina,    potencialRs: potGas, anpTrend: anp.gasolina,    spark: anp.spark.gasolina }),
    buildFossil({ nome: "🚚 Diesel S10",  key: "diesel_s10",  defasagem: defDie, dias: diasDie, distTrend: t.diesel_s10,  potencialRs: potDie, anpTrend: anp.diesel_s10,  spark: anp.spark.diesel_s10 }),
    buildFossil({ nome: "🚛 Diesel S500", key: "diesel_s500", defasagem: defDie, dias: diasDie, distTrend: t.diesel_s500, potencialRs: potDie, anpTrend: anp.diesel_s500, spark: anp.spark.diesel_s500 }),
    buildEtanol({ nome: "🌱 Etanol",      key: "etanol",      distTrend: t.etanol, spark: anp.spark.etanol }),
  ];

  data.decisao = {
    data_label: data.meta?.date_label || "",
    base_fossil: "barril (Brent 5d) + defasagem ABICOM + mídia + repasse distribuidoras/ANP" + (SUPA ? " + custo distribuidora" : ""),
    base_etanol: "ciclo de safra + ESALQ/CEPEA + safra de milho + mídia sucroenergética",
    disclaimer: "Não é recomendação de compra — modelo educacional. A confiança reflete a convergência dos sinais (máx 97%). Reajuste da Petrobras e clima da safra têm componente imprevisível.",
    fuels
  };

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log("✓ Decisão do Dia v4 gravada em " + DATA_PATH);
  for (const f of fuels) {
    console.log(`  ${f.emoji} ${f.nome}: ${f.label} (${f.score}/100, confiança ${f.confianca_pct}%)${f.cenario?.coerente === false ? "  ⚠️ INCOERENTE" : ""}`);
    console.log(`     ↳ ${f.cenario?.resumo}`);
  }
  process.exit(0);
})();
