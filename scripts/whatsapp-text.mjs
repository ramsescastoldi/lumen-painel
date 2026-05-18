#!/usr/bin/env node
/**
 * whatsapp-text.mjs — gera a versão TEXTO (formatada pra WhatsApp) do painel.
 *
 * Roda no GitHub Actions após decisao.mjs. Lê data.json e escreve wa-text.txt.
 * O conteúdo é enviado pro WhatsApp do Ramsés (556592657008) pelo workflow n8n.
 * 100% determinístico — ZERO IA.
 *
 * Env: DATA_PATH (default data.json), OUT (default wa-text.txt)
 */
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = process.env.DATA_PATH || "data.json";
const OUT = process.env.OUT || "wa-text.txt";
const d = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const HR = "━━━━━━━━━━━━━━━━━━";
const L = []; // linhas
const push = (s = "") => L.push(s);

const meta = d.meta || {};
push(`🎯 *POSTO EM DIA*`);
push(`_${meta.date_label || ""}${meta.last_update ? " · " + meta.last_update : ""}_`);
push();

// ---- DECISÃO DO DIA (topo — é a promessa do clube) ----
const dec = d.decisao;
if (dec && Array.isArray(dec.fuels) && dec.fuels.length) {
  push(HR);
  push(`🛒 *COMPRAR OU ESPERAR HOJE?*`);
  push();
  for (const f of dec.fuels) {
    const nome = (f.nome || f.key || "").replace(/^[^\wÀ-ÿ]+\s*/, m => m); // mantém emoji
    push(`${f.emoji || "•"} *${(f.nome || f.key)} — ${f.label}*  (${f.score}/100)`);
    for (const r of (f.reasons || []).slice(0, 2)) {
      const txt = String(r.text || "").replace(/<\/?b>/g, "*");
      push(`   • ${txt}`);
    }
    push();
  }
}

// ---- MANCHETE ----
const mp = d.manchete?.principal || {};
if (mp.titulo) {
  push(HR);
  push(`📰 *Manchete*`);
  push(`${mp.status_emoji || ""} ${mp.titulo}`.trim());
  push();
}

// ---- INDICADORES-CHAVE ----
const p = d.petroleo || {}, md = d.moedas || {}, j = d.juros || {}, inf = d.inflacao || {}, ab = d.abicom || {};
push(HR);
push(`📊 *Indicadores*`);
if (p.brent?.val) push(`🛢️ Brent ${p.brent.val}${p.brent.delta ? " · " + p.brent.delta : ""}`);
if (md.usdbrl?.val) push(`💵 USD ${md.usdbrl.val}${md.eurbrl?.val ? "  ·  EUR " + md.eurbrl.val : ""}`);
if (j.selic?.val || inf.ipca?.val) push(`🏦 Selic ${j.selic?.val || "—"}  ·  IPCA ${inf.ipca?.val || "—"}`);
if (ab.defasagem_gasolina_pct || ab.defasagem_diesel_pct)
  push(`🚢 Defasagem ABICOM — gasolina ${ab.defasagem_gasolina_pct || "—"} / diesel ${ab.defasagem_diesel_pct || "—"}`);
push();

// ---- AÇÕES DO DIA ----
const acoes = (d.acoes_dia || []).filter(Boolean);
if (acoes.length) {
  push(HR);
  push(`⚡ *Ações do dia*`);
  acoes.slice(0, 3).forEach((a, i) => push(`${i + 1}. ${String(a).replace(/<\/?b>/g, "*").replace(/<[^>]+>/g, "")}`));
  push();
}

// ---- LINK + DISCLAIMER ----
push(HR);
push(`🔗 Painel completo:`);
push(`https://painel.lumenclubpainel.com.br/`);
push();
push(`_${dec?.disclaimer || "Essa não é uma recomendação de compra, apenas uma sugestão baseada num modelo educacional."}_`);
push(`*Lumen Posto Club*`);

const text = L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
writeFileSync(OUT, text, "utf8");
console.log(`✓ ${OUT} gerado (${text.length} chars)`);
console.log("--- preview ---\n" + text.slice(0, 600) + (text.length > 600 ? "\n..." : ""));
