#!/usr/bin/env node
/**
 * historico.mjs — acumula snapshot diário em history.json (rolling 30 dias).
 *
 * Roda no GitHub Actions APÓS decisao.mjs. Lê data.json, extrai os números-chave,
 * e adiciona uma entrada no history.json. Mantém só os últimos 30 dias.
 *
 * Na PRIMEIRA execução (history.json vazio), faz backfill das séries do BCB
 * (USD, EUR, Selic, IPCA — todas têm histórico público) pra que os sparklines
 * já tenham conteúdo desde o dia 1. ABICOM/CEPEA acumula natural.
 *
 * Zero IA, 100% determinístico. ~2KB/dia. Arquivo limita em ~60KB.
 *
 * Env: DATA_PATH (default data.json), HISTORY_PATH (default history.json)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA_PATH = process.env.DATA_PATH || "data.json";
const HISTORY_PATH = process.env.HISTORY_PATH || "history.json";
const KEEP_DAYS = 30;

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/[Rr]\$\s*/, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const today = data.meta?.date_iso || new Date().toISOString().split("T")[0];

const snapshot = {
  date: today,
  brent: num(data.petroleo?.brent?.val),
  wti: num(data.petroleo?.wti?.val),
  usdbrl: num(data.moedas?.usdbrl?.val),
  eurbrl: num(data.moedas?.eurbrl?.val),
  selic: num(data.juros?.selic?.val),
  ipca: num(data.inflacao?.ipca?.val),
  def_gas: num(data.abicom?.defasagem_gasolina_pct),
  def_die: num(data.abicom?.defasagem_diesel_pct),
  dias_gas: Number(data.abicom?.dias_sem_ajuste_gasolina) || null,
  dias_die: Number(data.abicom?.dias_sem_ajuste_diesel) || null,
  pot_gas: num(data.abicom?.potencial_aumento_rs_gasolina),
  pot_die: num(data.abicom?.potencial_aumento_rs_diesel),
  cepea_hid: num(data.cepea?.hidratado_sp),
  cepea_ani: num(data.cepea?.anidro_sp),
  decisao: {
    gasolina: data.decisao?.fuels?.find(f => f.key === "gasolina")?.score ?? null,
    diesel_s10: data.decisao?.fuels?.find(f => f.key === "diesel_s10")?.score ?? null,
    diesel_s500: data.decisao?.fuels?.find(f => f.key === "diesel_s500")?.score ?? null,
    etanol: data.decisao?.fuels?.find(f => f.key === "etanol")?.score ?? null,
  }
};

// Lê o history existente
let history = { days: [] };
if (existsSync(HISTORY_PATH)) {
  try { history = JSON.parse(readFileSync(HISTORY_PATH, "utf8")); } catch {}
  if (!Array.isArray(history.days)) history.days = [];
}

// Backfill BCB se está vazio (primeira vez)
if (history.days.length === 0) {
  console.log("📥 history.json vazio — fazendo backfill BCB (USD/EUR/Selic/IPCA)...");
  const series = { usdbrl: 1, eurbrl: 21619, selic: 432, ipca: 433 };
  const backfill = new Map(); // key=date, val={usdbrl, eurbrl, selic, ipca}
  for (const [field, code] of Object.entries(series)) {
    try {
      const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/20?formato=json`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { console.log(`  ! BCB SGS ${code} HTTP ${r.status}`); continue; }
      const arr = await r.json();
      for (const row of arr) {
        const [dd, mm, yyyy] = row.data.split("/");
        const iso = `${yyyy}-${mm}-${dd}`;
        if (iso > today) continue; // ignora datas futuras (Selic "válido até próximo Copom" etc.)
        if (!backfill.has(iso)) backfill.set(iso, { date: iso });
        backfill.get(iso)[field] = parseFloat(row.valor);
      }
      console.log(`  ✓ ${field} (SGS ${code}): ${arr.length} pontos`);
    } catch (e) {
      console.log(`  ! ${field}: ${e.message}`);
    }
  }
  // Adiciona o backfill (sem sobrescrever hoje que vem depois)
  const sortedDates = [...backfill.keys()].sort();
  for (const d of sortedDates) {
    if (d !== today) history.days.push(backfill.get(d));
  }
  console.log(`✓ Backfill: ${history.days.length} pontos históricos adicionados`);
}

// Adiciona/atualiza snapshot de hoje
const idx = history.days.findIndex(d => d.date === today);
if (idx >= 0) history.days[idx] = { ...history.days[idx], ...snapshot };
else history.days.push(snapshot);

// Ordena e trunca pra últimos KEEP_DAYS
history.days.sort((a, b) => a.date.localeCompare(b.date));
if (history.days.length > KEEP_DAYS) history.days = history.days.slice(-KEEP_DAYS);

writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf8");
console.log(`✓ ${HISTORY_PATH} atualizado — ${history.days.length} dias acumulados (${history.days[0]?.date} → ${history.days.at(-1)?.date})`);
