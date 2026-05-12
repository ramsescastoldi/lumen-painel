#!/usr/bin/env node
/**
 * gerar-painel.mjs — gera data.json novo via Claude API com web search
 *
 * Roda dentro do GitHub Actions diariamente. Lê o data.json atual como referência
 * de estrutura, chama Claude API com web_search habilitado para pesquisar os
 * indicadores do dia, e grava o data.json atualizado.
 *
 * Variáveis de ambiente esperadas:
 *   ANTHROPIC_API_KEY — chave da API Anthropic
 *
 * Saída:
 *   Escreve em data.json (overwrite). Retorna exit 0 em sucesso, 1 em falha.
 */

import { readFileSync, writeFileSync } from "node:fs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("✗ ANTHROPIC_API_KEY não definida");
  process.exit(1);
}

const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const DATA_PATH = process.env.DATA_PATH || "data.json";

// Lê estrutura atual como referência
const currentData = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const structureExample = JSON.stringify(currentData, null, 2);

// Data de hoje em formato BRT
const now = new Date();
const brtNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Cuiaba" }));
const isoDate = brtNow.toISOString().split("T")[0];
const diasSemana = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayOfWeek = diasSemana[brtNow.getDay()];
const dateLabel = `${dayOfWeek} · ${brtNow.getDate().toString().padStart(2, "0")} ${meses[brtNow.getMonth()]} ${brtNow.getFullYear()}`;
const hora = brtNow.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Cuiaba" });

console.log(`📅 Gerando painel para ${isoDate} (${dateLabel}) — atualização ${hora}`);

const SYSTEM_PROMPT = `Você é o editor-chefe do Lumen Posto Club. Sua tarefa é gerar o JSON do **Painel Diário "Posto em Dia"** para HOJE.

## CONTEXTO
- **Organização:** Lumen Posto Club
- **Responsável editorial:** Ramsés
- **Missão:** inteligência de mercado acionável para donos de posto e revendedores de combustíveis no Brasil
- **Hoje:** ${isoDate} — ${dateLabel}
- **Hora atualização:** ${hora}

## REGRAS INVIOLÁVEIS
1. **NUNCA fabricar valores.** Se fonte não localizada → use "a confirmar" como valor
2. Emojis direcionais obrigatórios: ▼ (queda), ▲ (alta), • (estável)
3. Tom: copy-ready, conciso, direto. Cada \`nota\` no máximo 2-3 frases
4. **Use web_search** para pesquisar TODOS os indicadores. Não invente, não use cache mental
5. Severidade da manchete: "red" (crítico/alerta), "yellow" (atenção), "green" (calmo/positivo)

## INDICADORES A PESQUISAR (use web_search)

### Bloco PETRÓLEO
- "Brent crude oil price today ${isoDate}"
- "WTI crude oil price today ${isoDate}"

### Bloco MOEDAS
- "dólar hoje cotação USD BRL ${isoDate} Banco Central"
- "EUR/BRL ${isoDate}"
- "Bitcoin price today USD"
- "DXY dollar index today"

### Bloco BOLSAS
- "Ibovespa fechamento ${isoDate}"
- "S&P 500 close ${isoDate}"
- "Nasdaq close ${isoDate}"
- "Dow Jones close ${isoDate}"

### Bloco JUROS
- "Selic taxa atual Copom 2026"
- "Fed funds rate ${isoDate}"
- "US Treasury 10Y yield ${isoDate}"

### Bloco INFLAÇÃO
- "IPCA-15 último resultado IBGE 2026"
- "Boletim Focus inflação 2026 expectativa"

### Bloco ABICOM (defasagem Petrobras)
- "Abicom defasagem Petrobras diesel gasolina ${isoDate}"
- "Petrobras último reajuste preços combustíveis 2026"

### Bloco ANP
- "ANP síntese semanal preços combustíveis gasolina etanol diesel GLP semana ${isoDate}"

### Bloco CEPEA
- "CEPEA ESALQ etanol hidratado SP PR GO MG MT preço ${isoDate}"
- "CEPEA etanol anidro SP preço"

### Bloco SAFRA UNICA
- "UNICA Centro-Sul moagem cana ATR mix açúcar etanol última quinzena 2026"

### Bloco GEOPOLÍTICA / MANCHETE
- Pesquisar 2-3 notícias mais relevantes do dia que afetam petróleo/combustíveis no Brasil
- Foco: tensões geopolíticas Oriente Médio, decisões OPEP+, ações regulatórias ANP/CNPE no Brasil, movimentações Petrobras

## ESTRUTURA EXATA DO JSON DE SAÍDA

Saída deve ser **JSON puro** (sem markdown, sem preâmbulo, sem explicação), mantendo EXATAMENTE a estrutura do exemplo abaixo. Não adicione nem remova campos top-level.

\`\`\`json
${structureExample}
\`\`\`

## CAMPOS QUE VOCÊ DEVE PREENCHER

- \`meta.date_iso\`: "${isoDate}"
- \`meta.date_label\`: "${dateLabel}"
- \`meta.last_update\`: "${hora}"
- \`meta.next_update\`: "amanhã · ${(brtNow.getDate() + 1).toString().padStart(2, "0")} ${meses[brtNow.getMonth()]} · 07:30"
- \`manchete.principal\`: a notícia mais importante do dia (geopolítica/petróleo/regulação). severity red/yellow/green. titulo + corpo em HTML (negrito permitido com <b>)
- \`manchete.secundarias\`: array de 3 notícias secundárias relevantes
- \`petroleo.brent\`, \`petroleo.wti\`: cotações com val, delta (variação dia), dir (up/down/flat), sub (info extra como range/semana)
- \`petroleo.nota\`: 2-3 frases editoriais sobre o cenário do petróleo
- \`petroleo.citacao\`: opcional, frase de analistas (Goldman, ING, Sparta, etc.) se houver
- \`moedas.usdbrl/eurbrl/dxy/btc\`: val, delta, dir
- \`moedas.nota\`: contexto editorial do câmbio
- \`bolsas.ibov/sp/nasdaq/dow\`: val, delta, dir
- \`bolsas.nota\`: contexto editorial bolsas
- \`juros.selic/fed\`: val, delta, dir. \`ust10y\` = val, sub
- \`juros.nota\`: contexto editorial juros
- \`inflacao\`: ipca15, ipca15_12m, ipca_mar, focus_2026 + nota
- \`abicom\`: diesel_pct, gasolina_pct, dias_diesel (número), dias_gasolina, diesel_tag/gasolina_tag (rótulos como "Pressão volta", "Estável"), nota
- \`anp.semana\`: descrição da semana ANP (ex: "Síntese semana 03-09/mai")
- \`anp.rows\`: array de produtos com produto, preco, status (green/yellow/red/gray/blue), status_label
- \`anp.nota\`: contexto editorial ANP
- \`cepea.hidratado\`: array por UF (SP, PR, GO, MG, MT) com uf, preco, dir
- \`cepea.anidro_sp\`: val, delta, dir
- \`cepea.acucar\`: val, delta, dir
- \`cepea.nota\`: contexto editorial
- \`eg\`: paridade_sp (ex "72%"), mandato_e (E30), mandato_b (B15), nota
- \`safra\`: moagem, atr, mix, oferta (cada um com val + delta), nota
- \`agenda\`: 4-5 eventos próximos com day, evento, tag (red/blue/green), tag_label
- \`radar\`: array de 5 bullets HTML com destaques do dia
- \`acao.tag\`: rótulo do estado de alerta (ex "Volta a vermelho — atenção máxima", "Cenário calmo", "Atenção média")
- \`acao.lead\`: lead em HTML com contexto
- \`acao.items\`: 4-6 ações operacionais (HTML com <b>)
- \`resumo\`: 6-7 parágrafos editoriais HTML cobrindo todo o cenário do dia. Primeiro item tem \`"lead": true\`

## SAÍDA

Devolva APENAS o JSON. Sem code blocks, sem texto antes ou depois. Pronto pra \`JSON.parse()\`.`;

const USER_PROMPT = `Pesquise e gere o painel completo para ${isoDate}. Use web_search para todos os indicadores. Responda APENAS com o JSON.`;

async function callClaude() {
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
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 12
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
  // Resposta da API tem array de content blocks. Pegar todos os text blocks
  // e concatenar (o output final ficará no último text block normalmente)
  const textBlocks = apiResponse.content.filter(b => b.type === "text").map(b => b.text);
  return textBlocks.join("\n").trim();
}

function parseJSON(text) {
  // Tentar parsear direto
  try {
    return JSON.parse(text);
  } catch {}

  // Se veio com code blocks ```json ... ```, extrair
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  // Tentar achar { ... } com balanced braces
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  throw new Error("Não consegui parsear JSON da resposta do Claude");
}

(async () => {
  try {
    console.log(`🤖 Chamando Claude (${MODEL}) com web search...`);
    const t0 = Date.now();
    const result = await callClaude();
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

    // Validações básicas
    if (!newData.meta || !newData.manchete || !newData.petroleo) {
      throw new Error("JSON parsado mas faltam campos essenciais (meta/manchete/petroleo)");
    }

    // Garante data correta no meta
    newData.meta.date_iso = isoDate;
    newData.meta.date_label = dateLabel;
    newData.meta.last_update = hora;

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
