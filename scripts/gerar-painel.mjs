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

## INDICADORES A PESQUISAR (use web_search — até 5 buscas, em ORDEM, parando se já tiver dados suficientes)
1. "Brent WTI petróleo cotação hoje ${isoDate}"
2. "Abicom defasagem Petrobras diesel gasolina ${isoDate} dias janelas fechadas potencial aumento R$/L"  ← **CRÍTICO**: extraia (a) % defasagem (ambos combustíveis), (b) dias sem importação/janelas fechadas (ambos), (c) **potencial de aumento em R$/L** que a Petrobras precisaria subir pra alcançar a paridade (ABICOM publica isso, ex: "R$ 1,12/L diesel"), (d) detecte sinal: Petrobras anunciou que NÃO vai importar → "nao_importa"; tem MP de subsídio → "mp_subsidio"; reajuste anunciado/iminente → "reajuste_anunciado"; Petrobras acabou de reajustar (últimos 7 dias) → "reajustou_recente"; senão → "nenhum". Coloca em `sinal_petrobras`
3. "mandato anidro etanol gasolina E30 B15 biodiesel diesel ${isoDate} CNPE ANP" ← extraia % anidro na gasolina E % B100 no diesel
4. "Focus Banco Central Brasil expectativa Selic IPCA 2026 boletim semanal" ← extraia previsão Focus para Selic fim 2026 e IPCA 2026
${isMonday ? '5. "CEPEA ESALQ etanol hidratado anidro SP usina + UNICA safra moagem mix Centro-Sul ${isoDate}"' : '5. notícia principal do dia + UNICA safra etanol mix (combine numa busca só)'}

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
- **abicom**: % defasagem (gasolina e diesel), dias sem importação/janelas fechadas, **potencial_aumento_rs_***: quanto a Petrobras precisaria subir em R$/L pra alcançar paridade (ABICOM publica explicitamente). Detecte `sinal_petrobras` (uma das opções listadas na pesquisa #2)
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
    const maxUses = fatos.hasData ? 5 : 7; // bumped 3→5 em 2026-05-20 pq tinha muito "a confirmar" (dias_sem_ajuste, mandatos, Focus, safra)

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
