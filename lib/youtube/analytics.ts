// YouTube Analytics (kanal sahibinin tek seferlik onayıyla, salt okuma):
// video başına izlenme süresi, ortalama izleme süresi ve oranı, abone kazanımı;
// kanal geneli trafik kaynakları. Anahtarlar: YT_CLIENT_ID / YT_CLIENT_SECRET /
// YT_ANALYTICS_REFRESH_TOKEN. Not: YouTube bu verileri ~2-3 gün gecikmeyle işler.

export type YtVideoAnalytics = { views: number; minutes: number; avgSec: number; avgPct: number; subsGained: number; subsLost: number };
export type YtAnalytics = { from: string; to: string; byVideo: Record<string, YtVideoAnalytics>; traffic: { source: string; views: number }[] };

export function analyticsConfigured(): boolean {
  return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_ANALYTICS_REFRESH_TOKEN);
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID ?? "", client_secret: process.env.YT_CLIENT_SECRET ?? "",
      refresh_token: process.env.YT_ANALYTICS_REFRESH_TOKEN ?? "", grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Analytics yetkisi alınamadı: ${j.error_description || j.error || r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function report(params: Record<string, string>): Promise<{ columnHeaders?: { name: string }[]; rows?: (string | number)[][] }> {
  const r = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?" + new URLSearchParams({ ids: "channel==MINE", ...params }), {
    headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json()) as { columnHeaders?: { name: string }[]; rows?: (string | number)[][]; error?: { message?: string } };
  if (!r.ok) throw new Error(`YouTube Analytics ${r.status}: ${j.error?.message?.slice(0, 160) ?? ""}`);
  return j;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Kanalın başından (from) bugüne video başına metrikler + trafik kaynakları
export async function fetchAnalytics(from: string): Promise<YtAnalytics> {
  const to = isoDay(new Date());
  const v = await report({
    startDate: from, endDate: to, dimensions: "video", sort: "-views", maxResults: "200",
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost",
  });
  const byVideo: Record<string, YtVideoAnalytics> = {};
  for (const row of v.rows ?? []) {
    const [id, views, minutes, avgSec, avgPct, gained, lost] = row;
    byVideo[String(id)] = { views: +views, minutes: +minutes, avgSec: +avgSec, avgPct: +avgPct, subsGained: +gained, subsLost: +lost };
  }
  let traffic: { source: string; views: number }[] = [];
  try {
    const t = await report({ startDate: from, endDate: to, dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views" });
    traffic = (t.rows ?? []).map((r) => ({ source: String(r[0]), views: +r[1] }));
  } catch { /* trafik raporu olmasa da devam */ }
  return { from, to, byVideo, traffic };
}

// Trafik kaynağı kodlarının Türkçesi
export const TRAFFIC_TR: Record<string, string> = {
  SHORTS: "Shorts akışı", YT_SEARCH: "YouTube araması", SUBSCRIBER: "Abone akışı", YT_CHANNEL: "Kanal sayfası",
  YT_OTHER_PAGE: "Diğer YouTube sayfaları", RELATED_VIDEO: "Önerilen videolar", BROWSE: "Ana sayfa / göz atma",
  EXT_URL: "Dış bağlantılar", NO_LINK_OTHER: "Doğrudan / bilinmeyen", PLAYLIST: "Oynatma listesi", NOTIFICATION: "Bildirim",
  END_SCREEN: "Bitiş ekranı", HASHTAGS: "Hashtag sayfası", SOUND_PAGE: "Ses sayfası",
};
