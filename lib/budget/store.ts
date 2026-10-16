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
  cacheRead?: number; // önbellekten okunan girdi tokenı (0.1× fiyat)
  cacheWrite?: number; // önbelleğe yazılan girdi tokenı (1.25× fiyat)
};
export type AllTime = DayUsage & { since: string }; // Nova genelinde tüm zamanlar toplamı
export type Budget = {
  dailyTokenCap: number; // 0 = sınırsız
  allTime?: AllTime;
  days: Record<string, DayUsage>; // "YYYY-MM-DD" → kullanım
};

// Yaklaşık fiyatlar ($/1M token) [girdi, çıktı] — SADECE tahmini gösterim için.
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [5, 25], // tahmini: Opus 5 fiyatı varsayıldı (doğrulanmadı)
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-fable-5": [10, 50],
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-haiku-4-5": [1, 5],
};

const FILE = path.join(process.cwd(), "data", "budget.json");
let state: Budget = { dailyTokenCap: 0, days: {} };
let loaded = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function priceOf(model: string): [number, number] {
  return PRICE[model] || [3, 15];
}

export function costOf(model: string, input: number, output: number): number {
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
    // ilk kez: tüm zamanlar toplamını eldeki günlerden başlat (geçmiş dahil)
    if (!state.allTime) {
      const keys = Object.keys(state.days).sort();
      const a: AllTime = { input: 0, output: 0, costUsd: 0, requests: 0, cacheRead: 0, cacheWrite: 0, since: keys[0] ?? todayKey() };
      for (const k of keys) {
        const u = state.days[k];
        a.input += u.input; a.output += u.output; a.costUsd += u.costUsd; a.requests += u.requests;
        a.cacheRead! += u.cacheRead ?? 0; a.cacheWrite! += u.cacheWrite ?? 0;
      }
      state.allTime = a;
    }
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
  cache?: { read?: number | null; write?: number | null },
): Promise<void> {
  await ensureLoaded();
  const i = Math.max(0, input | 0), o = Math.max(0, output | 0);
  const cr = Math.max(0, (cache?.read ?? 0) | 0), cw = Math.max(0, (cache?.write ?? 0) | 0);
  const [pi] = priceOf(model);
  const cost = costOf(model, i, o) + (cr * pi * 0.1 + cw * pi * 1.25) / 1e6;
  const k = todayKey();
  const add = (u: DayUsage) => {
    u.input += i; u.output += o; u.costUsd += cost; u.requests += 1;
    u.cacheRead = (u.cacheRead ?? 0) + cr; u.cacheWrite = (u.cacheWrite ?? 0) + cw;
  };
  const u = state.days[k] || { input: 0, output: 0, costUsd: 0, requests: 0 };
  add(u);
  state.days[k] = u;
  state.allTime ??= { input: 0, output: 0, costUsd: 0, requests: 0, since: k };
  add(state.allTime);
  // eski günleri buda (tüm zamanlar toplamı ayrıca tutulur, kaybolmaz)
  const keys = Object.keys(state.days).sort();
  while (keys.length > 400) delete state.days[keys.shift() as string];
  await persist();
}

// Nova geneli harcama özeti (tüm projeler + ekip dışı işler)
export async function usageTotals() {
  await ensureLoaded();
  const tok = (u?: DayUsage) => (u ? u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0);
  const today = todayUsage();
  const month = todayKey().slice(0, 7);
  let mUsd = 0, mTok = 0;
  for (const [k, u] of Object.entries(state.days)) if (k.startsWith(month)) { mUsd += u.costUsd; mTok += tok(u); }
  const a = state.allTime;
  return {
    allTime: { tokens: tok(a), usd: a?.costUsd ?? 0, requests: a?.requests ?? 0, since: a?.since ?? todayKey() },
    month: { tokens: mTok, usd: mUsd },
    today: { tokens: tok(today), usd: today.costUsd, requests: today.requests },
  };
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
