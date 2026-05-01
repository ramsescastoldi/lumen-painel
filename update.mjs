#!/usr/bin/env node
/**
 * update.mjs — substitui o bloco DATA dentro de index.html pelo conteúdo de data.json
 * Uso:  node update.mjs
 *       node update.mjs --src=template.html --out=index.html --data=data.json
 *
 * Como funciona: localiza o bloco entre os marcadores
 *   const DATA = {  ...  };
 * e reescreve com o conteúdo do data.json formatado como JS literal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

const args = Object.fromEntries(
  argv.slice(2).map(a => a.replace(/^--/, "").split("="))
);
const SRC  = args.src  || "index.html";
const OUT  = args.out  || "index.html";
const DATA = args.data || "data.json";

const data = JSON.parse(readFileSync(DATA, "utf8"));
delete data._comentario;
const html = readFileSync(SRC, "utf8");

const re = /const DATA = \{[\s\S]*?\n\};/m;
if (!re.test(html)) {
  console.error("✗ Marcador 'const DATA = {...};' não encontrado em " + SRC);
  process.exit(1);
}

// Carimba data e hora atuais quando não vierem no JSON
if (!data.meta?.last_update) {
  const now = new Date();
  data.meta = data.meta || {};
  data.meta.last_update = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const block = "const DATA = " + JSON.stringify(data, null, 2) + ";";
const next = html.replace(re, block);
writeFileSync(OUT, next, "utf8");

console.log(`✓ Atualizado: ${OUT}  (data: ${DATA})`);
console.log(`  Edição: ${data.meta?.date_label ?? "—"}`);
console.log(`  Manchete: ${data.manchete?.titulo ?? "—"}`);
