#!/usr/bin/env node
/**
 * anp-historico.mjs — mantém anp-historico.json (média semanal Brasil por produto)
 *
 * Bootstrap (2026-06-10): série jan→jun/2026 gerada localmente a partir dos
 * CSVs/XLSX mensais oficiais da ANP (~358k coletas agregadas) e commitada.
 * Este script só faz APPEND incremental: baixa os CSVs "últimas 4 semanas"
 * (leves, ~3-8MB) e recalcula as semanas presentes neles. Semanas antigas
 * ficam intocadas. Roda no GitHub Actions diário após gerar-painel.mjs.
 *
 * Sem dependências externas — parser CSV próprio (formato ANP é regular).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import https from "node:https";

const PATH = process.env.ANP_HIST_PATH || "anp-historico.json";
const PRODUTOS = {
  "GASOLINA": "gasolina",
  "ETANOL": "etanol",
  "DIESEL": "diesel_s500",
  "DIESEL S10": "diesel_s10",
};
const URLS = [
  "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-gasolina-etanol.csv",
  "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv",
];

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    https.get(url, { headers: { "User-Agent": "lumen-painel/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchUrl(res.headers.location, redirects + 1).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function segundaDaSemana(isoDate) {
  const d = new Date(isoDate + "T12:00:00Z");
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}
function parseDateBR(s) {
  const m = String(s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function parsePreco(s) {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(",", "."));
  return isFinite(n) && n > 0.5 && n < 30 ? n : null;
}

(async () => {
  if (!existsSync(PATH)) {
    console.error(`✗ ${PATH} não existe — o bootstrap inicial precisa ser commitado antes.`);
    process.exit(1);
  }
  const hist = JSON.parse(readFileSync(PATH, "utf8"));

  // Agrega as coletas da janela recente por semana×produto
  const acc = new Map();
  for (const url of URLS) {
    let raw;
    try { raw = (await fetchUrl(url)).replace(/^﻿/, ""); }
    catch (e) { console.log(`⚠️  fetch falhou (${url.split("/").pop()}): ${e.message} — mantendo histórico atual`); continue; }
    const lines = raw.split(/\r?\n/);
    const header = (lines[0] || "").split(";");
    const iProduto = header.indexOf("Produto");
    const iData = header.findIndex(h => h.startsWith("Data da Coleta"));
    const iPreco = header.findIndex(h => h.startsWith("Valor de Venda"));
    if (iProduto < 0 || iData < 0 || iPreco < 0) { console.log(`⚠️  header inesperado em ${url.split("/").pop()} — pulando`); continue; }
    let n = 0;
    for (let li = 1; li < lines.length; li++) {
      const cols = lines[li].split(";");
      if (cols.length < header.length - 2) continue;
      const key = PRODUTOS[String(cols[iProduto] || "").trim().toUpperCase()];
      const data = parseDateBR(cols[iData]);
      const preco = parsePreco(cols[iPreco]);
      if (!key || !data || preco == null) continue;
      const semana = segundaDaSemana(data);
      const k = `${semana}|${key}`;
      const cur = acc.get(k) || { soma: 0, n: 0 };
      cur.soma += preco; cur.n++;
      acc.set(k, cur);
      n++;
    }
    console.log(`  ${url.split("/").pop()}: ${n} coletas`);
  }

  if (acc.size === 0) {
    console.log("ℹ️  Nenhum dado novo — histórico mantido como está.");
    process.exit(0);
  }

  // Upsert: recalcula as semanas presentes na janela (mais completas a cada dia),
  // preserva semanas antigas que saíram da janela.
  let upserts = 0;
  for (const [k, v] of acc) {
    const [semana, produto] = k.split("|");
    const arr = hist.produtos[produto] || (hist.produtos[produto] = []);
    const media = Number((v.soma / v.n).toFixed(3));
    const idx = arr.findIndex(it => it.s === semana);
    if (idx >= 0) {
      // só atualiza se a nova agregação tem MAIS coletas (semana ainda enchendo)
      if (v.n >= (arr[idx].n || 0)) { arr[idx] = { s: semana, p: media, n: v.n }; upserts++; }
    } else {
      arr.push({ s: semana, p: media, n: v.n });
      upserts++;
    }
    arr.sort((a, b) => a.s.localeCompare(b.s));
  }

  hist.atualizado_em = new Date().toISOString();
  writeFileSync(PATH, JSON.stringify(hist, null, 1));
  for (const [k, arr] of Object.entries(hist.produtos)) {
    console.log(`${k}: ${arr.length} semanas · última ${arr.at(-1)?.s} R$ ${arr.at(-1)?.p}`);
  }
  console.log(`✓ ${PATH} atualizado (${upserts} semanas upserted)`);
  process.exit(0);
})().catch(e => { console.error("✗", e.message); process.exit(1); });
