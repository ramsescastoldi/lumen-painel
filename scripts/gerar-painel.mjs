#!/usr/bin/env node
/**
 * gerar-painel.mjs (v2 — Haiku 4.5 + estrutura enxuta)
 *
 * Gera data.json novo via Claude API com web search. Roda dentro do GitHub Actions.
 *
 * Mudanças v2 (2026-05-14):
 *   - Modelo padrão Haiku 4.5 (mais barato; ~R$ 25/mês estimado)
 *   - Estrutura enxuta: removidos ANP, E/G, Bolsas, DXY, BTC, Fed, UST10Y
 *   - Adicionado bloco "mandatos" (% anidro gasolina, % B100 diesel)
 *   - Agenda agora é síntese semanal seg–sex (não eventos com data)
 *   - CEPEA só busca real na segunda; outros dias herda do data.json atual
 *   - 3 ações + 3 itens de radar (não mais 5–6)
 *   - max_uses=6, max_tokens=6000 (config conservadora pra Haiku passar)
 *
 * Vars de ambiente:
 *   ANTHROPIC_API_KEY — obrigatório
 *   MODEL             — default claude-haiku-4-5-20251001
 *   DATA_PATH         — default data.json
 */

import { readFileSync, writeFileSync } from "node:fs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("✗ ANTHROPIC_API_KEY não definida");
  process.exit(1);
}

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const DATA_PATH = process.env.DATA_PATH || "data.json";

const currentData = JSON.parse(readFileSync(DATA_PATH, "utf8"));

// Manchete anterior para anti-repetição
const previousManchete = (currentData.manchete?.principal?.titulo || "").slice(0, 240);
const previousSecundarias = (currentData.manchete?.secundarias || [])
  .map(s => s.titulo)
  .filter(Boolean)
  .slice(0, 5);
const previousDateIso = currentData.meta?.date_iso || "";

// Data de hoje em BRT
const now = new Date();
const brtNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const isoDate = brtNow.toISOString().split("T")[0];
const diasSemana = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayOfWeek = diasSemana[brtNow.getDay()];
const dateLabel = `${dayOfWeek} · ${brtNow.getDate().toString().padStart(2, "0")} ${meses[brtNow.getMonth()]} ${brtNow.getFullYear()}`;
const hora = brtNow.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// CEPEA só atualiza segunda-feira (getDay()===1). Outros dias herda valor anterior.
const isMonday = brtNow.getDay() === 1;
const cepeaHerdado = !isMonday ? (currentData.cepea || null) : null;

console.log(`📅 Gerando painel para ${isoDate} (${dateLabel}) — atualização ${hora}`);
console.log(`📰 Manchete anterior (NÃO REPETIR): "${previousManchete.slice(0, 100)}..."`);
console.log(`🌱 CEPEA: ${isMonday ? "BUSCAR (segunda-feira)" : "HERDAR do data.json atual"}`);

// Estrutura-exemplo enxuta (sem campos legados)
const structureExample = JSON.stringify({
  meta: { date_iso: isoDate, date_label: dateLabel, last_update: hora },
  manchete: {
    principal: { severity: "red|yellow|green", status_emoji: "🔴|🟡|🟢", severity_label: "Crítico|Atenção|Calmo", titulo: "frase forte do dia" },
    secundarias: [
      { categoria: "Mercado", titulo: "...", severity: "red|yellow|green", status_emoji: "🔴|🟡|🟢" },
      { categoria: "Combustíveis", titulo: "...", severity: "red|yellow|green", status_emoji: "🔴|🟡|🟢" },
      { categoria: "Política", titulo: "...", severity: "red|yellow|green", status_emoji: "🔴|🟡|🟢" }
    ]
  },
  petroleo: {
    brent: { val: "US$ X,XX", delta: "▼ -X% ou ▲ +X%", dir: "down|up|flat" },
    wti:   { val: "US$ X,XX", delta: "▼ -X% ou ▲ +X%", dir: "down|up|flat" },
    resumo: "2–3 frases sobre o cenário do petróleo e impacto pro revendedor."
  },
  abicom: {
    defasagem_gasolina_pct: "XX%",
    defasagem_diesel_pct: "XX%",
    dias_sem_ajuste_gasolina: 0,
    dias_sem_ajuste_diesel: 0,
    potencial_aumento_rs_gasolina: "R$ X,XX/L",
    potencial_aumento_rs_diesel: "R$ X,XX/L",
    sinal_petrobras: "nenhum|nao_importa|mp_subsidio|reajuste_anunciado|reajustou_recente"
  },
  moedas: {
    usdbrl: { val: "R$ X,XXX", delta: "▼/▲ ±X,XX%", dir: "down|up|flat" },
    eurbrl: { val: "R$ X,XX",  delta: "▼/▲ ±X,XX%", dir: "down|up|flat" }
  },
  juros: {
    selic: { val: "XX,XX%", delta: "▼ -X,XX p.p. ou • mantida", dir: "down|up|flat" },
    previsao_focus: "XX,XX% (fim 2026)"
  },
  inflacao: {
    ipca: { val: "X,XX%", delta: "▼/▲ vs. mês anterior", dir: "down|up|flat" },
    previsao_focus: "X,XX% (2026)"
  },
  mandatos: {
    anidro_na_gasolina_pct: "XX%",
    b100_no_diesel_pct: "XX%"
  },
  cepea: {
    hidratado_sp: "R$ X,XXXX/L",
    anidro_sp: "R$ X,XXXX/L",
    ultima_atualizacao_iso: isoDate,
    ultima_atualizacao_label: "seg DD/mmm"
  },
  safra_etanol: {
    moagem: "XX,XX Mt",
    var_anual: "+/-X,XX% a/a",
    mix_etanol_pct: "XX,XX%",
    oferta_total: "X,XX bi L (+/-X% a/a)"
  },
  agenda_semanal: {
    segunda: "evento principal ou — se vazio",
    terca: "evento principal ou —",
    quarta: "evento principal ou —",
    quinta: "evento principal ou —",
    sexta: "evento principal ou —"
  },
  acoes_dia: [
    "<b>Ação 1:</b> texto curto e acionável.",
    "<b>Ação 2:</b> ...",
    "<b>Ação 3:</b> ..."
  ],
  radar: [
    "<b>Tema 1:</b> síntese curta.",
    "<b>Tema 2:</b> ...",
    "<b>Tema 3:</b> ..."
  ],
  resumo_editorial: "<p class=\"lead\">Lead editorial.</p><p>Parágrafo 2.</p><p>Parágrafo 3 acionável.</p>"
}, null, 2);

const SYSTEM_PROMPT = `Você é o editor-chefe do Lumen Posto Club. Gere o JSON do **Painel Diário "Posto em Dia"** de HOJE.

## CONTEXTO
- Hoje: ${isoDate} — ${dateLabel}
- Hora atualização: ${hora}
- Público: donos de posto e revendedores de combustíveis no Brasil

## REGRAS INVIOLÁVEIS
1. **NUNCA fabricar valores.** Se não localizar fonte → use "a confirmar"
2. Emojis direcionais: ▼ (queda), ▲ (alta), • (estável)
3. Tom: copy-ready, conciso, direto. Frases curtas.
4. **Use web_search** para pesquisar os indicadores. Não invente.
5. Severity: "red" (crítico/alerta), "yellow" (atenção), "green" (calmo/positivo)
6. **NÃO REPETIR manchete anterior** — busque o que mudou nas últimas 24h

## ⛔ MANCHETE DA EDIÇÃO ANTERIOR (${previousDateIso}) — NÃO REPETIR
Principal anterior:
> "${previousManchete}"
Secundárias anteriores:
${previousSecundarias.map(s => `> "${s}"`).join("\n")}

Sua manchete principal DEVE ser sobre fato novo (últimas 12–24h). Se cenário não mudou, escolha ângulo diferente.

## ✅ FATOS CONFIRMADOS (fonte oficial Banco Central — USE EXATAMENTE, NÃO PESQUISAR)
__FATOS__
Para os blocos \`moedas\`, \`juros\` e \`inflacao\` use EXATAMENTE os números acima (vindos da API do Banco Central). NÃO gaste web_search com câmbio/Selic/IPCA.

## INDICADORES A PESQUISAR (use web_search — até 6 buscas, em ORDEM, parando se já tiver dados suficientes)

1. **🚨 BREAKING — POLÍTICA DE PREÇOS PETROBRAS / MP / DECRETO DAS ÚLTIMAS 72H** (sempre fazer, ANTES de qualquer outra busca):
   Query sugerida: "Petrobras reajuste preço diesel gasolina hoje OR ontem ${meses[brtNow.getMonth()]} ${brtNow.getFullYear()} OR MP medida provisória combustível subsídio DOU ${meses[brtNow.getMonth()]} ${brtNow.getFullYear()} OR isenção PIS Cofins combustível"
   **OBJETIVO**: detectar qualquer movimento recente do governo/Petrobras que afete o sinal_petrobras. Procure especificamente:
   - Petrobras subiu/cortou preço de venda às distribuidoras nos últimos 7 dias → \`sinal_petrobras\`: "reajustou_recente"
   - MP nova criou subvenção/subsídio a produtores ou importadores → \`sinal_petrobras\`: "mp_subsidio"
   - Petrobras anunciou que NÃO vai importar / janelas fechadas → \`sinal_petrobras\`: "nao_importa"
   - Reajuste anunciado/iminente mas ainda não em vigor → \`sinal_petrobras\`: "reajuste_anunciado"
   - Nada relevante encontrado → \`sinal_petrobras\`: "nenhum"
   **IMPORTANTE**: Se identificar reajuste/MP do dia, REFLITA o fato na \`manchete.principal\` (esse é o lead do dia). NUNCA marque "nenhum" sem fazer essa busca. Cite a referência (ex: "MP 1.358/2026") na manchete e no resumo_editorial.

2. "Brent WTI petróleo cotação hoje ${isoDate}"

3. "Abicom defasagem Petrobras diesel gasolina ${isoDate} dias janelas fechadas potencial aumento R$/L" ← extraia (a) % defasagem (ambos combustíveis), (b) dias sem importação/janelas fechadas (ambos), (c) potencial de aumento em R$/L pra paridade (ABICOM publica, ex: "R$ 1,12/L diesel"). **Para \`dias_sem_ajuste_*\`: se a busca #1 detectou \`reajustou_recente\`, ZERE \`dias_sem_ajuste_diesel\` (ou _gasolina, conforme o combustível reajustado).**

4. "mandato anidro etanol gasolina E30 B15 biodiesel diesel ${isoDate} CNPE ANP" ← extraia % anidro na gasolina E % B100 no diesel

5. "Focus Banco Central Brasil expectativa Selic IPCA 2026 boletim semanal" ← extraia previsão Focus para Selic fim 2026 e IPCA 2026

${isMonday ? '6. "CEPEA ESALQ etanol hidratado anidro SP usina + UNICA safra moagem mix Centro-Sul ${isoDate}"' : '6. notícia principal do dia + UNICA safra etanol mix (combine numa busca só)'}

${isMonday ? "" : `## ⚠️ CEPEA HERDADO — NÃO PESQUISAR
Hoje não é segunda-feira. O bloco \`cepea\` será **herdado automaticamente** do data.json atual. **Não inclua o campo \`cepea\` no seu JSON de saída.** O script vai mesclar:
\`\`\`json
${JSON.stringify(cepeaHerdado, null, 2)}
\`\`\`
`}

## REGRAS POR BLOCO

- **manchete.principal**: 1 frase forte, severity coerente com o fato
- **manchete.secundarias**: SEMPRE 3 itens, um de cada categoria ["Mercado", "Combustíveis", "Política"]
- **petroleo**: brent + wti + resumo curto (2–3 frases). Não cite analistas longamente.
- **abicom**: % defasagem (gasolina e diesel), dias sem importação/janelas fechadas, **potencial_aumento_rs_***: quanto a Petrobras precisaria subir em R$/L pra alcançar paridade (ABICOM publica explicitamente). \`sinal_petrobras\` deve refletir o que foi descoberto na busca #1 (BREAKING). Se a busca #1 retornou MP/reajuste novo: NUNCA marque "nenhum". Se a busca não trouxe nada do dia/semana e a manchete da edição anterior também não menciona MP/reajuste: pode marcar "nenhum"
- **moedas**: USD/BRL e EUR/BRL apenas. Cotação + variação dia.
- **juros**: Selic atual + variação + previsão Focus para fim do ano
- **inflacao**: IPCA mais recente + variação + previsão Focus
- **mandatos**: % anidro na gasolina (ex "30%") e % B100 no diesel (ex "15%"). Pesquise se houve mudança recente.
- **safra_etanol**: moagem, variação anual, mix etanol, oferta total
- **agenda_semanal**: síntese por dia da SEMANA ATUAL (seg, ter, qua, qui, sex). UMA frase curta por dia. "—" se nada relevante. Eventos: Focus (toda 2ª), IPCA/IPCA-15, Copom (quando houver), UNICA (quinzenas), ANP (sex), reuniões geopolíticas relevantes, divulgações Petrobras.
- **acoes_dia**: 3 ações operacionais para o dono de posto HOJE. HTML com <b>. Cada uma 1–2 frases.
- **radar**: 3 temas de impacto do dia. HTML com <b>. Cada um 1–2 frases.
- **resumo_editorial**: HTML com 3 parágrafos. Primeiro com class="lead". Síntese dos dados + manchetes.

## ESTRUTURA EXATA DO JSON DE SAÍDA

\`\`\`json
${structureExample}
\`\`\`

## SAÍDA

Devolva APENAS o JSON. Sem markdown, sem texto antes ou depois. Pronto pra JSON.parse().${isMonday ? "" : ' **Importante: NÃO inclua o campo `cepea` no seu JSON** — o script vai herdar do data.json atual.'}`;

const USER_PROMPT = `Pesquise e gere o painel completo para ${isoDate}. Use web_search para os indicadores. Responda APENAS com o JSON.`;

// ---- BCB (Banco Central) — séries SGS oficiais, grátis, sem chave ----
// Substitui as buscas web do Haiku por números EXATOS. Reduz custo e erra menos.
async function bcbSerie(id, n = 2) {
  try {
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${id}/dados/ultimos/${n}?formato=json`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const arr = await r.json();
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch { return null; }
}
function dirOf(cur, prev) {
  if (prev == null || cur == null) return "flat";
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat";
}
async function fetchFatosBCB() {
  // SGS: 1=USD venda, 21619=EUR venda, 432=Selic meta %a.a., 433=IPCA %mês
  const [usd, eur, selic, ipca] = await Promise.all([
    bcbSerie(1, 2), bcbSerie(21619, 2), bcbSerie(432, 1), bcbSerie(433, 2)
  ]);
  const lines = [];
  const out = {};
  if (usd) {
    const cur = parseFloat(usd.at(-1).valor), prev = usd.length > 1 ? parseFloat(usd[0].valor) : null;
    const dir = dirOf(cur, prev);
    out.usdbrl = { val: `R$ ${cur.toFixed(4).replace(".", ",")}`, dir, data: usd.at(-1).data };
    lines.push(`- USD/BRL (PTAX venda, ${usd.at(-1).data}): R$ ${cur.toFixed(4).replace(".", ",")} — ${dir}`);
  }
  if (eur) {
    const cur = parseFloat(eur.at(-1).valor), prev = eur.length > 1 ? parseFloat(eur[0].valor) : null;
    const dir = dirOf(cur, prev);
    out.eurbrl = { val: `R$ ${cur.toFixed(4).replace(".", ",")}`, dir, data: eur.at(-1).data };
    lines.push(`- EUR/BRL (PTAX venda, ${eur.at(-1).data}): R$ ${cur.toFixed(4).replace(".", ",")} — ${dir}`);
  }
  if (selic) {
    const cur = parseFloat(selic.at(-1).valor);
    out.selic = { val: `${cur.toFixed(2).replace(".", ",")}% a.a.`, data: selic.at(-1).data };
    lines.push(`- Selic meta (${selic.at(-1).data}): ${cur.toFixed(2).replace(".", ",")}% a.a.`);
  }
  if (ipca) {
    const cur = parseFloat(ipca.at(-1).valor), prev = ipca.length > 1 ? parseFloat(ipca[0].valor) : null;
    const dir = dirOf(cur, prev);
    out.ipca = { val: `${cur.toFixed(2).replace(".", ",")}% (mês)`, dir, data: ipca.at(-1).data };
    lines.push(`- IPCA mensal (${ipca.at(-1).data}): ${cur.toFixed(2).replace(".", ",")}% — ${dir} vs. mês anterior`);
  }
  const block = lines.length
    ? lines.join("\n")
    : "(API do BCB indisponível agora — pesquise câmbio/Selic/IPCA via web_search como fallback, +2 buscas permitidas)";
  return { block, hasData: lines.length > 0, out };
}

async function callClaude(systemPrompt, maxUses) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: USER_PROMPT }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: maxUses
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  return response.json();
}

function extractFinalText(apiResponse) {
  const textBlocks = apiResponse.content.filter(b => b.type === "text").map(b => b.text);
  return textBlocks.join("\n").trim();
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error("Não consegui parsear JSON da resposta do Claude");
}

(async () => {
  try {
    console.log("🏦 Buscando câmbio/Selic/IPCA na API do Banco Central...");
    const fatos = await fetchFatosBCB();
    console.log(fatos.hasData ? "✓ BCB ok:\n" + fatos.block : "⚠️  BCB indisponível — fallback web_search");
    const systemFinal = SYSTEM_PROMPT.replace("__FATOS__", fatos.block);
    const maxUses = fatos.hasData ? 6 : 8; // bumped 5→6 em 2026-06-01 pra acomodar a busca dedicada "breaking — política Petrobras/MP últimas 72h" (sinal_petrobras estava ficando "nenhum" mesmo quando havia MP nova)

    console.log(`🤖 Chamando Claude (${MODEL}) — max_uses=${maxUses}, max_tokens=6000...`);
    const t0 = Date.now();
    const result = await callClaude(systemFinal, maxUses);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`✓ Resposta recebida em ${elapsed}s`);
    console.log(`  Stop reason: ${result.stop_reason}`);
    console.log(`  Tokens: in=${result.usage?.input_tokens ?? "?"} out=${result.usage?.output_tokens ?? "?"}`);
    if (result.usage?.server_tool_use?.web_search_requests) {
      console.log(`  Web searches: ${result.usage.server_tool_use.web_search_requests}`);
    }

    const finalText = extractFinalText(result);
    console.log(`  Texto final: ${finalText.length} chars`);

    const newData = parseJSON(finalText);

    // Validações de campos essenciais
    if (!newData.meta || !newData.manchete || !newData.petroleo) {
      throw new Error("JSON parsado mas faltam campos essenciais (meta/manchete/petroleo)");
    }

    // Garante meta correta
    newData.meta.date_iso = isoDate;
    newData.meta.date_label = dateLabel;
    newData.meta.last_update = hora;

    // CEPEA: herda do data.json atual se não é segunda
    if (!isMonday && cepeaHerdado) {
      newData.cepea = cepeaHerdado;
      console.log(`  CEPEA herdado (última atualização: ${cepeaHerdado.ultima_atualizacao_label || "?"})`);
    } else if (isMonday) {
      // Em segunda, garantir o label de atualização
      if (newData.cepea) {
        newData.cepea.ultima_atualizacao_iso = isoDate;
        newData.cepea.ultima_atualizacao_label = `seg ${brtNow.getDate().toString().padStart(2, "0")}/${meses[brtNow.getMonth()]}`;
      }
    }

    // CARRY-FORWARD: se o Haiku marcou um campo crítico como "a confirmar" mas o
    // data.json anterior tinha valor real, mantém o valor anterior. ABICOM, mandatos
    // e safra mudam pouco dia-a-dia; preservar evita regressão silenciosa do painel.
    function _isMissing(v) {
      if (v == null) return true;
      const s = String(v).toLowerCase().trim();
      return s === "" || s.includes("a confirmar") || s === "0";
    }
    function _carry(blockName, fields) {
      const newBlk = newData[blockName] || (newData[blockName] = {});
      const oldBlk = currentData[blockName] || {};
      for (const f of fields) {
        if (_isMissing(newBlk[f]) && !_isMissing(oldBlk[f])) {
          newBlk[f] = oldBlk[f];
          console.log(`  ↩ carry-forward ${blockName}.${f}: ${oldBlk[f]}`);
        }
      }
    }
    _carry("abicom", ["defasagem_gasolina_pct","defasagem_diesel_pct","dias_sem_ajuste_gasolina","dias_sem_ajuste_diesel","potencial_aumento_rs_gasolina","potencial_aumento_rs_diesel"]);
    _carry("mandatos", ["anidro_na_gasolina_pct","b100_no_diesel_pct"]);
    _carry("safra_etanol", ["moagem","var_anual","mix_etanol_pct","oferta_total"]);

    // SANITY CHECK ANTI-REGRESSÃO da defasagem ABICOM:
    // Se Haiku trouxer defasagem MAIS ALTA do que a anterior enquanto dias_sem_ajuste
    // é baixo (reajuste recente), é forte indício de que ele puxou notícia antiga
    // como se fosse atual. Fato real: defasagem só pode aumentar significativamente
    // se Brent disparou >15% ou USD disparou >10% no dia (eventos raros). Caso
    // contrário, rollback pro valor anterior + warning.
    //
    // Este check foi adicionado em 2026-06-04 após 2 incidentes seguidos: Haiku
    // do dia 01/jun marcou sinal=nenhum perdendo MP 1.358; Haiku do dia 04/jun
    // trouxe defasagem 58%/48% (números de abril) enquanto Petrobras tinha
    // reajustado diesel -9,6% em 01/jun e gasolina +R$0,48 em 29/mai.
    function _pctNum(s) {
      if (s == null) return null;
      const m = String(s).replace(",", ".").match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    }
    function _rsNum(s) {
      if (s == null) return null;
      const m = String(s).replace(/[Rr]\$\s*/, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    }
    function _antiRegressao(combust) {
      const newAb = newData.abicom || {};
      const oldAb = currentData.abicom || {};
      const diasField = combust === "diesel" ? "dias_sem_ajuste_diesel" : "dias_sem_ajuste_gasolina";
      const defField = combust === "diesel" ? "defasagem_diesel_pct" : "defasagem_gasolina_pct";
      const potField = combust === "diesel" ? "potencial_aumento_rs_diesel" : "potencial_aumento_rs_gasolina";
      const dias = Number(newAb[diasField] ?? oldAb[diasField] ?? 999);
      const novaDef = _pctNum(newAb[defField]);
      const antigaDef = _pctNum(oldAb[defField]);
      const novoRs = _rsNum(newAb[potField]);
      const antigoRs = _rsNum(oldAb[potField]);
      // Regra 1: reajuste muito recente (≤3 dias) E defasagem subiu → suspeitíssimo
      // Regra 2: reajuste recente (≤7 dias) E defasagem subiu >10pp → muito suspeito
      // Regra 3: reajuste recente (≤7 dias) E potencial R$/L subiu >R$ 0,40 → suspeito
      if (novaDef != null && antigaDef != null && dias <= 3 && novaDef > antigaDef + 2) {
        console.log(`⚠️  ANTI-REGRESSÃO ${combust}: defasagem nova ${novaDef}% > antiga ${antigaDef}% mas reajuste foi há ${dias} dias. ROLLBACK pra ${antigaDef}%.`);
        newAb[defField] = oldAb[defField];
        if (novoRs != null && antigoRs != null && novoRs > antigoRs + 0.10) {
          newAb[potField] = oldAb[potField];
          console.log(`   ↩ potencial R$/L ${combust} também: ${novoRs} → ${antigoRs}`);
        }
        return;
      }
      if (novaDef != null && antigaDef != null && dias <= 7 && novaDef > antigaDef + 10) {
        console.log(`⚠️  ANTI-REGRESSÃO ${combust}: defasagem nova ${novaDef}% > antiga ${antigaDef}% +10pp mas reajuste foi há ${dias} dias. ROLLBACK.`);
        newAb[defField] = oldAb[defField];
        if (novoRs != null && antigoRs != null && novoRs > antigoRs + 0.30) newAb[potField] = oldAb[potField];
        return;
      }
      if (novoRs != null && antigoRs != null && dias <= 7 && novoRs > antigoRs + 0.40) {
        console.log(`⚠️  ANTI-REGRESSÃO ${combust}: potencial R$/L nova R$ ${novoRs} > antiga R$ ${antigoRs} +0,40 mas reajuste foi há ${dias} dias. ROLLBACK potencial.`);
        newAb[potField] = oldAb[potField];
      }
    }
    // ORDEM IMPORTA: primeiro normalizamos dias_sem_ajuste (sinal mais confiável,
    // vem do data.json carregado), depois usamos o valor corrigido como referência
    // pra anti-regressão das defasagens. Se dias for absurdo, marca o combustível
    // como "suspeito" — qualquer aumento na defasagem dele dispara rollback total.
    const _diasSuspeito = { diesel: false, gasolina: false };
    function _antiRegressaoDias(combust) {
      const newAb = newData.abicom || {};
      const oldAb = currentData.abicom || {};
      const field = combust === "diesel" ? "dias_sem_ajuste_diesel" : "dias_sem_ajuste_gasolina";
      const novo = Number(newAb[field]);
      const antigo = Number(oldAb[field]);
      if (!isFinite(novo) || !isFinite(antigo)) return;
      if (novo === 0) return; // reset legítimo
      if (novo <= antigo + 3) return;
      console.log(`⚠️  ANTI-REGRESSÃO dias_sem_ajuste_${combust}: nova ${novo} > antiga ${antigo} +3 (delta absurdo). Mantém antiga+1 = ${antigo + 1}.`);
      newAb[field] = antigo + 1;
      _diasSuspeito[combust] = true; // combustível inteiro vira suspeito
    }
    _antiRegressaoDias("diesel");
    _antiRegressaoDias("gasolina");

    _antiRegressao("diesel");
    _antiRegressao("gasolina");

    // Se dias_sem_ajuste foi rejeitado, qualquer AUMENTO na defasagem (mesmo
    // pequeno) é suspeito — ROLLBACK completo do bloco ABICOM daquele combustível.
    function _rollbackSeSuspeito(combust) {
      if (!_diasSuspeito[combust]) return;
      const newAb = newData.abicom || {};
      const oldAb = currentData.abicom || {};
      const defField = combust === "diesel" ? "defasagem_diesel_pct" : "defasagem_gasolina_pct";
      const potField = combust === "diesel" ? "potencial_aumento_rs_diesel" : "potencial_aumento_rs_gasolina";
      const novaDef = _pctNum(newAb[defField]); const antigaDef = _pctNum(oldAb[defField]);
      const novoRs = _rsNum(newAb[potField]); const antigoRs = _rsNum(oldAb[potField]);
      if (novaDef != null && antigaDef != null && novaDef > antigaDef) {
        console.log(`⚠️  COMBUSTÍVEL SUSPEITO (${combust}): dias inválido + defasagem subiu (${antigaDef}% → ${novaDef}%). ROLLBACK total.`);
        newAb[defField] = oldAb[defField];
      }
      if (novoRs != null && antigoRs != null && novoRs > antigoRs) {
        console.log(`   ↩ potencial ${combust}: R$ ${novoRs} → R$ ${antigoRs}`);
        newAb[potField] = oldAb[potField];
      }
    }
    _rollbackSeSuspeito("diesel");
    _rollbackSeSuspeito("gasolina");

    // SANITY CHECK sinal_petrobras: se Haiku marcou "nenhum"/"" mas a manchete
    // OU resumo_editorial mencionam MP/reajuste/subsídio, é um sinal forte de
    // que ele perdeu o evento. Log um warning bem visível pra próxima manutenção.
    {
      const sinal = String(newData.abicom?.sinal_petrobras || "").toLowerCase().trim();
      const textoCheck = (
        (newData.manchete?.principal?.titulo || "") + " " +
        (newData.manchete?.secundarias || []).map(s => s.titulo).join(" ") + " " +
        (newData.resumo_editorial || "")
      ).toLowerCase();
      const indicios = /\b(mp|medida provis[óo]ria|m\.p\.)\s*[\d\.]+|subv[eê]nc|subs[íi]dio.*combust|petrobras.*(corta|cortou|reduz|reduziu|reajust|sob[eo]|aument)|reajust.*(diesel|gasolina)|isen[çc][ãa]o.*pis/.test(textoCheck);
      if ((sinal === "" || sinal === "nenhum") && indicios) {
        console.log("⚠️  ALERTA: sinal_petrobras='" + (sinal || "vazio") + "' mas manchete/resumo mencionam MP/reajuste/subsídio. Haiku PROVAVELMENTE perdeu o evento. Verifique.");
        console.log("   Trecho relevante:", textoCheck.slice(0, 240));
      }
    }

    // FORÇA os números oficiais do BCB (Haiku não inventa câmbio/Selic/IPCA)
    if (fatos.hasData) {
      const f = fatos.out;
      newData.moedas = newData.moedas || {};
      if (f.usdbrl) newData.moedas.usdbrl = { ...(newData.moedas.usdbrl||{}), val: f.usdbrl.val, dir: f.usdbrl.dir, delta: (newData.moedas.usdbrl?.delta)||"PTAX BCB" };
      if (f.eurbrl) newData.moedas.eurbrl = { ...(newData.moedas.eurbrl||{}), val: f.eurbrl.val, dir: f.eurbrl.dir, delta: (newData.moedas.eurbrl?.delta)||"PTAX BCB" };
      if (f.selic) { newData.juros = newData.juros || {}; newData.juros.selic = { ...(newData.juros.selic||{}), val: f.selic.val }; }
      if (f.ipca) { newData.inflacao = newData.inflacao || {}; newData.inflacao.ipca = { ...(newData.inflacao.ipca||{}), val: f.ipca.val, dir: f.ipca.dir }; }
      console.log("  ✓ Câmbio/Selic/IPCA sobrescritos com dados oficiais do BCB");
    }

    // Comentário interno (deletado no build)
    newData._comentario = `Gerado automaticamente em ${new Date().toISOString()} por gerar-painel.mjs (${MODEL})`;

    writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));
    console.log(`✓ ${DATA_PATH} atualizado (${JSON.stringify(newData).length} bytes)`);
    console.log(`  Manchete: ${newData.manchete?.principal?.titulo?.slice(0, 80)}...`);

    process.exit(0);
  } catch (err) {
    console.error("✗ Erro:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
