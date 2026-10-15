// Günlük dolar kuru (USD→TRY): TCMB "today.xml" döviz satış kuru; olmazsa
// open.er-api.com. Sunucu belleğinde 3 saat tutulur.
export const runtime = "nodejs";

let cache: { usdTry: number; date: string; source: string; at: number } | null = null;

async function fetchRate() {
  try {
    const xml = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { signal: AbortSignal.timeout(8000) }).then((r) => r.text());
    const m = xml.match(/CurrencyCode="USD"[\s\S]*?<ForexSelling>([\d.]+)</);
    const d = xml.match(/Tarih="([\d.]+)"/);
    if (m) return { usdTry: Number(m[1]), date: d?.[1] ?? "", source: "TCMB" };
  } catch { /* yedek kaynağa geç */ }
  const j = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
  return { usdTry: Number(j.rates?.TRY), date: String(j.time_last_update_utc ?? "").slice(5, 16), source: "open.er-api" };
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 3 * 3600e3) {
    try {
      const r = await fetchRate();
      if (r.usdTry > 0) cache = { ...r, at: Date.now() };
    } catch { /* eldeki önbellekle devam */ }
  }
  if (!cache) return Response.json({ error: "kur alınamadı" }, { status: 503 });
  return Response.json({ usdTry: cache.usdTry, date: cache.date, source: cache.source });
}
