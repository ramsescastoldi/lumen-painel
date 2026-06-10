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

// Histórico ROLLING das últimas 7 manchetes (anti-repetição estrutural, 2026-06-10).
// O Haiku via só a manchete de ontem e "não repetir" não impedia repetir a ESTRUTURA:
// 5 dias seguidos de manchete abrindo com "Brent <número>". Agora a lista inteira
// vai pro prompt como proibida, e o JS mantém o rolling após cada run.
const manchetesRecentes = [
  ...(Array.isArray(currentData._manchetes_recentes) ? currentData._manchetes_recentes : []),
  ...(previousManchete && !(currentData._manchetes_recentes || []).includes(previousManchete) ? [previousManchete] : [])
].slice(-7);

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
  safra_milho: {
    tendencia: "alta_oferta|normal|baixa_oferta",
    nota: "1 frase curta sobre a safra de milho (etanol de milho no Centro-Oeste)"
  },
  midia_setor: {
    sentimento: "pressao_alta|neutro|pressao_baixa",
    n_materias: 0,
    resumo: "1 frase: o que a imprensa do setor está dizendo sobre preços de GASOLINA/DIESEL nos últimos 5 dias"
  },
  midia_etanol: {
    sentimento: "pressao_alta|neutro|pressao_baixa",
    n_materias: 0,
    resumo: "1 frase: o que a imprensa sucroenergética está dizendo sobre ETANOL/AÇÚCAR/SAFRA nos últimos 5 dias"
  },
  refinarias: {
    produto: "Diesel S-10 (R$/L às distribuidoras)",
    data_referencia: isoDate,
    items: [
      { nome: "Petrobras", regiao: "Nacional", preco_rs_l: "R$ X,XX/L", delta_vs_petrobras: "—", ultimo_reajuste: "DD/MM/AAAA (movimento)" },
      { nome: "Acelen (Mataripe)", regiao: "BA", preco_rs_l: "R$ X,XX/L", delta_vs_petrobras: "+R$ X,XX/L (+XX%)", ultimo_reajuste: "DD/MM/AAAA (movimento) · próximo programado DD/MM/AAAA (% reajuste)" },
      { nome: "BRAVA (Clara Camarão)", regiao: "RN", preco_rs_l: "R$ X,XX/L", delta_vs_petrobras: "+R$ X,XX/L (+XX%)", ultimo_reajuste: "DD/MM/AAAA (movimento)" }
    ],
    fonte: "Sites Petrobras/Acelen/BRAVA + ANP + imprensa local"
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

## ⛔ MANCHETES DOS ÚLTIMOS DIAS — PROIBIDO REPETIR TEMA E ESTRUTURA
${manchetesRecentes.map((m, i) => `${i + 1}. "${m}"`).join("\n")}
Secundárias de ontem (também não repetir):
${previousSecundarias.map(s => `> "${s}"`).join("\n")}

## 📰 REGRAS EDITORIAIS DA MANCHETE PRINCIPAL (novas 2026-06-10 — INVIOLÁVEIS)

A manchete é uma NOTÍCIA (fato novo das últimas 24h), não um RESUMO DE INDICADORES. O leitor é dono de posto que abre o painel todo dia — se a manchete parece a de ontem, o painel perde credibilidade.

1. **PROIBIDO abrir a manchete com cotação de Brent/WTI.** Cotação já tem bloco próprio. ÚNICA exceção: movimento ≥5% no dia ou recorde histórico (aí a variação É a notícia).
2. **PROIBIDO manchete de "estado contínuo"** (defasagem que segue alta, janelas que seguem fechadas, MP que segue vigente, Selic que segue X). Estado não é notícia. Só vira manchete se MUDOU nas últimas 24h.
3. **Hierarquia de impacto pro dono de posto** (escolha o item MAIS ALTO que tiver fato novo nas últimas 24h):
   a. Reajuste/anúncio Petrobras ou refinaria privada (Acelen/BRAVA) EM VIGOR ou anunciado HOJE/ONTEM
   b. MP/decreto/lei nova OU mudança em programa vigente (prorrogação, corte, fim de subsídio)
   c. Decisão CNPE/ANP/Confaz nova (mandato, tributo, fiscalização, leilão)
   d. Evento de mercado excepcional (Brent ±5%, USD ±2%, evento geopolítico NOVO — não a continuação do de ontem)
   e. Evento setorial: greve, desabastecimento, operação contra adulteração, dado ANP/UNICA recém-publicado com surpresa
   f. Se NADA novo: ângulo OPERACIONAL pro revendedor (ex: "Semana abre sem gatilho de reajuste; foco em margem e giro") — nunca reciclar a estrutura de ontem
4. **Use a data da fonte.** Se a notícia mais forte que você achou tem mais de 48h, ela NÃO pode ser manchete como se fosse de hoje (foi assim que um reajuste de março virou manchete falsa em junho). Confirme a data antes de promover a manchete.
5. As 3 secundárias seguem a mesma regra: priorize fato novo, proíba clone das de ontem.

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

7. **🗞️ MÍDIA DO SETOR — últimos 5 dias (DOIS sentimentos: fóssil + etanol)**:
   Query A (fóssil): "previsão reajuste combustível gasolina diesel preço próximos dias análise" (máx 5 dias)
   Query B (etanol): "preço etanol hidratado açúcar safra cana usina próximos dias análise OR mercado sucroenergético" (máx 5 dias)
   Objetivo: preencher \`midia_setor\` (gasolina/diesel) E \`midia_etanol\` (etanol/açúcar/safra). Para CADA um, classifique as matérias DOS ÚLTIMOS 5 DIAS:
   - Maioria aponta alta iminente/pressão de reajuste → \`sentimento\`: "pressao_alta"
   - Maioria aponta corte/queda/estabilidade prolongada → \`sentimento\`: "pressao_baixa"
   - Dividido ou sem cobertura relevante → \`sentimento\`: "neutro"
   Informe \`n_materias\` e \`resumo\` (1 frase) em CADA bloco. NÃO conte matérias com mais de 5 dias. Na dúvida → "neutro".
   **IMPORTANTE — etanol tem lógica própria**: a mídia do etanol é sobre SAFRA/AÇÚCAR/CLIMA/USINA, não sobre Petrobras. Não confunda os dois blocos.

7b. **🌽 SAFRA DE MILHO (etanol de milho no Centro-Oeste)**:
   Query sugerida: "safra milho ${brtNow.getFullYear()} Brasil produção etanol de milho Mato Grosso oferta CONAB"
   Objetivo: preencher \`safra_milho\`. O etanol de milho (MT/GO) cresce e amortece o preço do etanol total. Classifique:
   - Safra forte / oferta crescente / etanol de milho em expansão → \`tendencia\`: "alta_oferta"
   - Safra apertada / quebra / clima ruim / atraso safrinha → \`tendencia\`: "baixa_oferta"
   - Ritmo normal ou sem dado novo → \`tendencia\`: "normal"
   Inclua \`nota\` (1 frase). Na dúvida → "normal".

8. **Preços nas refinarias (Petrobras + Acelen Mataripe + BRAVA Clara Camarão) — Diesel S-10 R$/L**:
   Query sugerida: "preço diesel S-10 refinaria Petrobras Acelen Mataripe BRAVA Clara Camarão R$/L distribuidora ${meses[brtNow.getMonth()]} ${brtNow.getFullYear()}"
   Objetivo: alimentar o bloco \`refinarias.items\` com o preço VIGENTE de diesel S-10 em R$/L às distribuidoras em cada uma das 3 refinarias + data do último reajuste de cada.
   - **Petrobras**: preço diesel A nas refinarias (não confundir com diesel B15 ao consumidor). Após corte de 01/06/2026 ficou em R$ 3,30/L.
   - **Acelen (Mataripe-BA)**: refinaria privada. Tipicamente +70-80% acima da Petrobras pelo preço de mercado. Acompanhe site oficial e imprensa local da Bahia.
   - **BRAVA (Clara Camarão-RN)**: refinaria privada do RN. Reajustes semanais às quintas-feiras. Acompanhe Tribuna do Norte e Portal N10.
   - Calcule \`delta_vs_petrobras\` automaticamente: (preço_refinaria - preço_petrobras) e percentual.
   - Se não conseguir confirmar o preço VIGENTE de uma refinaria, use "a confirmar" no \`preco_rs_l\` daquele item.

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
- **refinarias**: SEMPRE 3 items na MESMA ORDEM (Petrobras, Acelen Mataripe, BRAVA Clara Camarão), produto fixo "Diesel S-10 (R$/L às distribuidoras)". \`delta_vs_petrobras\` da Petrobras é sempre "—". Pros outros 2, calcule o delta absoluto (\`+R$ X,XX/L\`) e percentual (\`+XX%\`) em relação à Petrobras. Se não conseguir confirmar preço atual, use "a confirmar" no \`preco_rs_l\`
- **midia_setor**: sentimento da imprensa sobre PREÇOS de GASOLINA/DIESEL nos últimos 5 dias (busca #7A). Campos \`sentimento\`/\`n_materias\`/\`resumo\`. Input do motor fóssil — na dúvida "neutro"
- **midia_etanol**: sentimento da imprensa SUCROENERGÉTICA sobre ETANOL/AÇÚCAR/SAFRA nos últimos 5 dias (busca #7B). Mesmos campos. Input do motor de etanol (separado do fóssil) — na dúvida "neutro"
- **safra_milho**: tendência da safra de milho / etanol de milho CW (busca #7b). \`tendencia\` (alta_oferta/normal/baixa_oferta) + \`nota\`. Input do motor de etanol — na dúvida "normal"
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
    const maxUses = fatos.hasData ? 9 : 11; // bumped 8→9 em 2026-06-10 (v4): mídia agora é DOIS sentimentos (fóssil + etanol) + safra de milho — inputs do motor de decisão separado por combustível

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

    // Carry-forward mídias e safra de milho: se Haiku não preencheu, herda o de ontem
    // (janelas são de 5 dias / safra muda devagar — valor de ontem é boa aproximação).
    if (!newData.midia_setor?.sentimento && currentData.midia_setor?.sentimento) {
      newData.midia_setor = currentData.midia_setor;
      console.log("  ↩ carry-forward midia_setor (Haiku não preencheu)");
    }
    if (!newData.midia_etanol?.sentimento && currentData.midia_etanol?.sentimento) {
      newData.midia_etanol = currentData.midia_etanol;
      console.log("  ↩ carry-forward midia_etanol (Haiku não preencheu)");
    }
    if (!newData.safra_milho?.tendencia && currentData.safra_milho?.tendencia) {
      newData.safra_milho = currentData.safra_milho;
      console.log("  ↩ carry-forward safra_milho (Haiku não preencheu)");
    }

    // Carry-forward INTELIGENTE pra refinarias.items: se Haiku não confirmou
    // o preço (veio "a confirmar"/"0"/empty), mantém o do data.json anterior.
    // Preserva também o nome/região/ultimo_reajuste já existentes.
    if (Array.isArray(currentData.refinarias?.items)) {
      newData.refinarias = newData.refinarias || {};
      newData.refinarias.items = newData.refinarias.items || [];
      for (const oldItem of currentData.refinarias.items) {
        const newItem = newData.refinarias.items.find(it => it?.nome === oldItem.nome);
        if (!newItem) {
          // Haiku esqueceu de incluir essa refinaria — clona inteira do anterior
          newData.refinarias.items.push({ ...oldItem });
          console.log(`  ↩ carry-forward refinaria ${oldItem.nome} (Haiku omitiu)`);
          continue;
        }
        for (const f of ["preco_rs_l", "delta_vs_petrobras", "ultimo_reajuste", "regiao"]) {
          if (_isMissing(newItem[f]) && !_isMissing(oldItem[f])) {
            newItem[f] = oldItem[f];
            console.log(`  ↩ carry-forward refinaria ${oldItem.nome}.${f}: ${oldItem[f]}`);
          }
        }
      }
    }

    // INCREMENTO AUTO de dias_sem_ajuste por delta de dias decorridos:
    // Bug 08/jun: Haiku trouxe os MESMOS dias do data.json anterior (7 e 4 herdados
    // do meu fix 05/jun) — passou pelo carry-forward e pelo sanity check porque
    // o valor estava "consistente". Mas é segunda 08/jun, o painel não rodou no
    // FDS — então deveria ter incrementado +3 dias automaticamente (gas 7→10, die 4→7).
    //
    // Esta função detecta: se data_iso atual > data_iso anterior E dias_sem_ajuste
    // veio igual ou menor que o anterior E não é reset (≠0) → bump por delta de dias.
    function _incrementarDiasPorDelta(field) {
      const newAb = newData.abicom || (newData.abicom = {});
      const oldAb = currentData.abicom || {};
      const novoDias = Number(newAb[field]);
      const antigoDias = Number(oldAb[field]);
      if (!isFinite(novoDias) || !isFinite(antigoDias)) return;
      if (novoDias === 0) return; // reset legítimo (reajuste hoje)
      const novoIso = newData.meta?.date_iso || isoDate;
      const antigoIso = currentData.meta?.date_iso;
      if (!novoIso || !antigoIso) return;
      const deltaMs = Date.parse(novoIso + "T00:00:00Z") - Date.parse(antigoIso + "T00:00:00Z");
      if (!isFinite(deltaMs) || deltaMs <= 0) return;
      const deltaDias = Math.round(deltaMs / 86400000);
      if (deltaDias <= 0) return;
      // Se Haiku entregou valor IGUAL ou MENOR que o anterior, ele esqueceu de incrementar
      if (novoDias <= antigoDias) {
        const corrigido = antigoDias + deltaDias;
        console.log(`  ⏩ incremento auto ${field}: ${novoDias} → ${corrigido} (delta ${deltaDias} dia(s) desde ${antigoIso})`);
        newAb[field] = corrigido;
      }
    }
    _incrementarDiasPorDelta("dias_sem_ajuste_gasolina");
    _incrementarDiasPorDelta("dias_sem_ajuste_diesel");

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

    // ===== ANTI-REPETIÇÃO DE MANCHETE (2026-06-10) =====
    // Mede similaridade Jaccard (palavras ≥4 letras) entre a manchete nova e as
    // últimas 7. Se ≥0,5 com qualquer uma, pede pro Haiku regerar SÓ a manchete
    // numa mini-call SEM web_search (barata, ~R$0,02) usando o contexto já gerado.
    function _palavras(s) {
      return new Set(String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 4));
    }
    function _jaccard(a, b) {
      const A = _palavras(a), B = _palavras(b);
      if (!A.size || !B.size) return 0;
      let inter = 0;
      for (const w of A) if (B.has(w)) inter++;
      return inter / (A.size + B.size - inter);
    }
    // Heurística estrutural: manchete que ABRE com cotação (Brent/WTI/petróleo)
    // é o padrão viciado que se repetiu 5 dias seguidos. Só é permitida se o
    // movimento for ≥5% (aí a variação É a notícia).
    function _abreComCotacao(s) {
      const primeira = String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .trim().split(/\s+/)[0] || "";
      return ["brent", "wti", "petroleo"].includes(primeira);
    }
    function _temMovimentoForte(s) {
      // Só conta % nos primeiros 40 chars (variação da cotação na abertura).
      // Sem esse corte, "…Selic em 13,50%" no fim da manchete liberava o padrão viciado.
      const matches = String(s).slice(0, 40).match(/(\d+[.,]?\d*)\s*%/g) || [];
      return matches.some(m => parseFloat(m.replace(",", ".")) >= 5);
    }
    function _mancheteRepetida(titulo) {
      let max = 0, qual = "";
      for (const m of manchetesRecentes) {
        const j = _jaccard(titulo, m);
        if (j > max) { max = j; qual = m; }
      }
      if (max >= 0.45) return { repetiu: true, score: max, qual, motivo: "jaccard" };
      if (_abreComCotacao(titulo) && !_temMovimentoForte(titulo) && manchetesRecentes.some(_abreComCotacao)) {
        return { repetiu: true, score: max, qual: "(padrão estrutural: abre com cotação, sem movimento ≥5%)", motivo: "estrutura" };
      }
      return { repetiu: false, score: max, qual, motivo: "" };
    }
    async function _regerarManchete() {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 500,
          system: `Você é editor-chefe de painel diário pra donos de posto de combustível. Reescreva APENAS a manchete principal. Regras: (1) é PROIBIDO repetir tema/estrutura de qualquer manchete da lista proibida; (2) PROIBIDO abrir com cotação Brent/WTI; (3) manchete = fato novo das últimas 24h OU ângulo operacional novo pro revendedor; (4) não fabricar fatos — use somente o que está no contexto. Responda APENAS com JSON: {"severity":"red|yellow|green","status_emoji":"🔴|🟡|🟢","severity_label":"Crítico|Atenção|Alívio","titulo":"..."}`,
          messages: [{
            role: "user",
            content: `MANCHETES PROIBIDAS:\n${manchetesRecentes.map(m => `- "${m}"`).join("\n")}\n- "${newData.manchete.principal.titulo}" (sua tentativa, repetiu estrutura)\n\nCONTEXTO DO DIA (use APENAS estes fatos):\nSecundárias: ${JSON.stringify((newData.manchete.secundarias || []).map(s => s.titulo))}\nResumo: ${String(newData.resumo_editorial || "").replace(/<[^>]+>/g, " ").slice(0, 900)}\nSinal Petrobras: ${newData.abicom?.sinal_petrobras}\n\nGere a manchete nova.`
          }]
        })
      });
      if (!r.ok) throw new Error(`mini-call manchete: HTTP ${r.status}`);
      const body = await r.json();
      const txt = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      return parseJSON(txt);
    }
    {
      const check = _mancheteRepetida(newData.manchete?.principal?.titulo || "");
      if (check.repetiu) {
        console.log(`⚠️  MANCHETE REPETIDA (Jaccard ${check.score.toFixed(2)} vs "${check.qual.slice(0, 70)}..."). Regenerando...`);
        try {
          const nova = await _regerarManchete();
          if (nova?.titulo) {
            const recheck = _mancheteRepetida(nova.titulo);
            if (!recheck.repetiu) {
              newData.manchete.principal = { ...newData.manchete.principal, ...nova };
              console.log(`  ✓ Manchete regenerada: "${nova.titulo.slice(0, 90)}..."`);
            } else {
              console.log(`  ⚠️ Regeneração TAMBÉM repetiu (${recheck.score.toFixed(2)}). Mantendo a primeira. Revisar manualmente.`);
            }
          }
        } catch (e) {
          console.log(`  ⚠️ Mini-call falhou (${e.message}). Mantendo manchete original.`);
        }
      } else {
        console.log(`  ✓ Manchete inédita (Jaccard máx ${check.score.toFixed(2)} vs últimas ${manchetesRecentes.length})`);
      }
    }

    // Mantém o rolling de manchetes (últimas 7) pro próximo run
    newData._manchetes_recentes = [...manchetesRecentes, newData.manchete?.principal?.titulo || ""]
      .filter(Boolean).slice(-7);

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
