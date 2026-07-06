// Bütçe kapıları (Bölüm 0.2): günlük LLM token takibi + tavan.
// Tavan dolunca YENİ sohbet işleri başlamaz (çalışan iş güvenle biter).
// Kalıcı: data/budget.json. Sıcak okuma bellekten (POST başında yüklenir).
import { promises as fs } from "fs";
import path from "path";

export type DayUsage = {
  input: number;
  output: number;
  costUsd: number; // ~tahmini
  requests: number;
};
export type Budget = {
  dailyTokenCap: number; // 0 = sınırsız
  days: Record<string, DayUsage>; // "YYYY-MM-DD" → kullanım
};

// Yaklaşık fiyatlar ($/1M token) [girdi, çıktı] — SADECE tahmini gösterim için.
const PRICE: Record<string, [number, number]> = {
  "claude-opus-4-8": [15, 75],
  "claude-sonnet-5": [3, 15],
  "claude-fable-5": [1, 5],
  "claude-haiku-4-5-20251001": [1, 5],
};

const FILE = path.join(process.cwd(), "data", "budget.json");
let state: Budget = { dailyTokenCap: 0, days: {} };
let loaded = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function costOf(model: string, input: number, output: number): number {
  const p = PRICE[model] || [3, 15];
  return (input / 1e6) * p[0] + (output / 1e6) * p[1];
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const d = JSON.parse(raw);
    if (d && typeof d.dailyTokenCap === "number" && d.days) state = d;
  } catch {
    /* yok → varsayılan (sınırsız) */
  }
}

async function persist(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* yazılamazsa bellekte geçerli */
  }
}

export async function getBudget(): Promise<Budget> {
  await ensureLoaded();
  return state;
}

export function todayUsage(): DayUsage {
  return state.days[todayKey()] || { input: 0, output: 0, costUsd: 0, requests: 0 };
}

// Sıcak yol (POST başında getBudget() ile yüklenmiş olmalı)
export function isOverCap(): boolean {
  const cap = state.dailyTokenCap;
  if (!cap || cap <= 0) return false;
  const u = todayUsage();
  return u.input + u.output >= cap;
}

export async function recordUsage(
  model: string,
  input: number,
  output: number,
): Promise<void> {
  await ensureLoaded();
  const k = todayKey();
  const u = state.days[k] || { input: 0, output: 0, costUsd: 0, requests: 0 };
  u.input += Math.max(0, input | 0);
  u.output += Math.max(0, output | 0);
  u.costUsd += costOf(model, Math.max(0, input | 0), Math.max(0, output | 0));
  u.requests += 1;
  state.days[k] = u;
  // eski günleri buda
  const keys = Object.keys(state.days).sort();
  while (keys.length > 40) delete state.days[keys.shift() as string];
  await persist();
}

export async function setCap(cap: number): Promise<Budget> {
  await ensureLoaded();
  state.dailyTokenCap = Math.max(0, Math.floor(cap) || 0);
  await persist();
  return state;
}

// UI için özet
export async function budgetStatus() {
  await ensureLoaded();
  const cap = state.dailyTokenCap;
  const u = todayUsage();
  const used = u.input + u.output;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return {
    cap,
    used,
    input: u.input,
    output: u.output,
    costUsd: Math.round(u.costUsd * 100) / 100,
    requests: u.requests,
    pct,
    warn: cap > 0 && used >= cap * 0.8 && used < cap,
    over: cap > 0 && used >= cap,
  };
}
