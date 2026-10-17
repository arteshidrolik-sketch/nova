// YouTube kanal takibi (YouTube Data API v3, yalnız herkese açık rakamlar):
// projeye bir kanal bağlanır; Nova 6 saatte bir kanalın "fotoğrafını" çeker
// (abone, toplam izlenme, video başına izlenme/beğeni) ve data/youtube/ altında
// saklar. Özet (son durum + 24 saat / 7 gün değişimi + öne çıkan videolar)
// proje kimliğinin altına eklenir → müdür ve uzmanlar gelişmeyi her görevde görür.
import { promises as fs } from "fs";
import path from "path";
import { analyticsConfigured, fetchAnalytics, TRAFFIC_TR, type YtAnalytics } from "./analytics";

const DIR = path.join(process.cwd(), "data", "youtube");
const LINKS = path.join(DIR, "links.json");
const API = "https://www.googleapis.com/youtube/v3";
const EVERY_MS = 6 * 3600e3;
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
const snapFile = (projectId: string) => path.join(DIR, `${safe(projectId)}.jsonl`);

export type YtLink = { channelId: string; title: string; handle?: string; linkedAt: number };
export type YtVideo = { id: string; title: string; publishedAt: string; views: number; likes: number; sec: number };
export type YtSnap = { ts: number; subs: number; views: number; videoCount: number; videos: YtVideo[]; analytics?: YtAnalytics };

function key(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY tanımlı değil");
  return k;
}

async function yt(pathAndQuery: string): Promise<Record<string, unknown>> {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const r = await fetch(`${API}/${pathAndQuery}${sep}key=${key()}`, { signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!r.ok) throw new Error(`YouTube API ${r.status}: ${j.error?.message?.slice(0, 160) ?? ""}`);
  return j;
}

async function readLinks(): Promise<Record<string, YtLink>> {
  try { return JSON.parse(await fs.readFile(LINKS, "utf8")); } catch { return {}; }
}
export async function getLink(projectId: string): Promise<YtLink | null> {
  return (await readLinks())[projectId] ?? null;
}

// Kanal kimliğini çöz: UC… kimliği, @kullanıcı adı, kanal ya da video bağlantısı
async function resolveChannel(input: string): Promise<{ id: string; title: string; handle?: string }> {
  const s = input.trim();
  let q = "";
  const uc = s.match(/(UC[\w-]{22})/);
  const handle = s.match(/@([\w.\-À-ɏ]+)/);
  const vid = s.match(/(?:shorts\/|watch\?v=|youtu\.be\/)([\w-]{11})/) ?? (/^[\w-]{11}$/.test(s) ? [s, s] : null);
  if (uc) q = `id=${uc[1]}`;
  else if (handle) q = `forHandle=${encodeURIComponent("@" + handle[1])}`;
  else if (vid) {
    const v = (await yt(`videos?part=snippet&id=${vid[1]}`)) as { items?: { snippet: { channelId: string } }[] };
    const cid = v.items?.[0]?.snippet.channelId;
    if (!cid) throw new Error("video bulunamadı");
    q = `id=${cid}`;
  } else throw new Error("kanal kimliği, @adı ya da video bağlantısı ver");
  const c = (await yt(`channels?part=snippet&${q}`)) as { items?: { id: string; snippet: { title: string; customUrl?: string } }[] };
  const it = c.items?.[0];
  if (!it) throw new Error("kanal bulunamadı");
  return { id: it.id, title: it.snippet.title, handle: it.snippet.customUrl };
}

export async function linkChannel(projectId: string, input: string): Promise<YtLink> {
  const ch = await resolveChannel(input);
  const links = await readLinks();
  links[projectId] = { channelId: ch.id, title: ch.title, handle: ch.handle, linkedAt: Date.now() };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(LINKS, JSON.stringify(links, null, 2));
  return links[projectId];
}

function isoSec(d: string): number {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : 0;
}

export async function snapshot(projectId: string): Promise<YtSnap> {
  const link = await getLink(projectId);
  if (!link) throw new Error("bu projeye kanal bağlı değil");
  const c = (await yt(`channels?part=statistics,contentDetails&id=${link.channelId}`)) as {
    items?: { statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[];
  };
  const ch = c.items?.[0];
  if (!ch) throw new Error("kanal okunamadı");
  // yüklemeler listesi (en çok 200 video)
  const ids: string[] = [];
  let page = "";
  for (let i = 0; i < 4; i++) {
    const p = (await yt(`playlistItems?part=contentDetails&maxResults=50&playlistId=${ch.contentDetails.relatedPlaylists.uploads}${page ? `&pageToken=${page}` : ""}`)) as {
      items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string;
    };
    ids.push(...(p.items ?? []).map((x) => x.contentDetails.videoId));
    if (!p.nextPageToken) break;
    page = p.nextPageToken;
  }
  const videos: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = (await yt(`videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, i + 50).join(",")}`)) as {
      items?: { id: string; snippet: { title: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string }; contentDetails: { duration: string } }[];
    };
    for (const x of v.items ?? []) {
      videos.push({ id: x.id, title: x.snippet.title, publishedAt: x.snippet.publishedAt, views: +(x.statistics.viewCount ?? 0), likes: +(x.statistics.likeCount ?? 0), sec: isoSec(x.contentDetails.duration) });
    }
  }
  const snap: YtSnap = { ts: Date.now(), subs: +(ch.statistics.subscriberCount ?? 0), views: +(ch.statistics.viewCount ?? 0), videoCount: +(ch.statistics.videoCount ?? 0), videos };
  // kanal sahibinin izni varsa: izleme süresi/oranı, abone kazanımı, trafik kaynakları
  if (analyticsConfigured() && videos.length) {
    const first = videos.reduce((a, v) => (v.publishedAt < a ? v.publishedAt : a), videos[0].publishedAt).slice(0, 10);
    try { snap.analytics = await fetchAnalytics(first); } catch (e) { console.warn("[youtube] analytics:", e instanceof Error ? e.message : e); }
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.appendFile(snapFile(projectId), JSON.stringify(snap) + "\n");
  return snap;
}

export async function readSnaps(projectId: string): Promise<YtSnap[]> {
  try {
    return (await fs.readFile(snapFile(projectId), "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as YtSnap);
  } catch { return []; }
}

// Bağlı tüm projeler: son fotoğraf 6 saatten eskiyse yenisini çek (zamanlayıcı her dakika çağırır)
let running = false;
export async function maybeSnapshotAll(): Promise<void> {
  if (running || !process.env.YOUTUBE_API_KEY) return;
  running = true;
  try {
    for (const pid of Object.keys(await readLinks())) {
      const snaps = await readSnaps(pid);
      if (snaps.length && Date.now() - snaps[snaps.length - 1].ts < EVERY_MS) continue;
      await snapshot(pid).catch((e) => console.warn("[youtube]", pid.slice(0, 8), e instanceof Error ? e.message : e));
    }
  } finally { running = false; }
}

// En yakın eski fotoğraf (en az `ago` ms önce)
function before(snaps: YtSnap[], ago: number): YtSnap | null {
  const t = Date.now() - ago;
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].ts <= t) return snaps[i];
  return null;
}

const n = (x: number) => x.toLocaleString("tr-TR");
const d = (x: number) => (x > 0 ? `+${n(x)}` : n(x));

// Ekip için metin özeti (proje kimliğinin altına eklenir)
export async function summaryText(projectId: string): Promise<string> {
  const link = await getLink(projectId);
  if (!link) return "";
  const snaps = await readSnaps(projectId);
  const last = snaps[snaps.length - 1];
  if (!last) return "";
  const day = before(snaps, 20 * 3600e3), week = before(snaps, 6.5 * 86400e3), first = snaps[0];
  const when = new Date(last.ts).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const prevViews = new Map((week ?? first).videos.map((v) => [v.id, v.views]));
  const vids = [...last.videos];
  const avg = vids.length ? Math.round(vids.reduce((a, v) => a + v.views, 0) / vids.length) : 0;
  const top = [...vids].sort((a, b) => b.views - a.views).slice(0, 5);
  const recent = [...vids].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 7);
  const movers = vids.map((v) => ({ v, g: v.views - (prevViews.get(v.id) ?? 0) })).filter((x) => x.g > 0).sort((a, b) => b.g - a.g).slice(0, 5);
  const ds = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
  const lines = [
    `Kanal: ${link.title}${link.handle ? ` (${link.handle})` : ""} · ölçüm: ${when} (Nova her 6 saatte bir otomatik ölçer; rakamlar herkese açık YouTube verisi)`,
    `- Abone: ${n(last.subs)}${day ? ` · 24 saatte ${d(last.subs - day.subs)}` : ""}${week ? ` · 7 günde ${d(last.subs - week.subs)}` : ""}`,
    `- Toplam izlenme: ${n(last.views)}${day ? ` · 24 saatte ${d(last.views - day.views)}` : ""}${week ? ` · 7 günde ${d(last.views - week.views)}` : ""}`,
    `- Video: ${n(last.videoCount)} · video başına ortalama ${n(avg)} izlenme`,
    `- Ölçüm geçmişi: ${snaps.length} kayıt, ilki ${new Date(first.ts).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}${!week ? " (7 günlük karşılaştırma için henüz yeterli geçmiş yok)" : ""}`,
    "En çok izlenenler:",
    ...top.map((v) => `  • ${v.title} — ${n(v.views)} izlenme, ${n(v.likes)} beğeni (${ds(v.publishedAt)})`),
    "Son yayınlananlar:",
    ...recent.map((v) => `  • ${ds(v.publishedAt)} · ${v.title} — ${n(v.views)} izlenme`),
    ...(movers.length && week ? ["Son 7 günde en çok izlenme kazananlar:", ...movers.map((x) => `  • ${x.v.title} — ${d(x.g)}`)] : []),
    ...analyticsLines(last),
  ];
  return lines.join("\n");
}

// Analytics bölümü: izleme oranı en yüksek/en düşük videolar, abone getirenler, trafik kaynakları
function analyticsLines(last: YtSnap): string[] {
  const a = last.analytics;
  if (!a) return ["Not: İzlenme süresi, izleme oranı ve trafik kaynakları henüz yok (YouTube Analytics bağlı değil ya da veri gelmedi); bunları rakam uydurarak yorumlama."];
  const title = new Map(last.videos.map((v) => [v.id, v.title]));
  const rows = Object.entries(a.byVideo).filter(([, m]) => m.views >= 3).map(([id, m]) => ({ id, t: title.get(id) ?? id, ...m }));
  const pct = (x: number) => "%" + Math.round(x);
  const byPct = [...rows].sort((x, y) => y.avgPct - x.avgPct);
  const totalTraffic = a.traffic.reduce((sum, t) => sum + t.views, 0) || 1;
  const gained = rows.filter((r) => r.subsGained > 0).sort((x, y) => y.subsGained - x.subsGained).slice(0, 5);
  const viewsSum = rows.reduce((sum, r) => sum + r.views, 0);
  const avgAll = viewsSum ? rows.reduce((sum, r) => sum + r.avgPct * r.views, 0) / viewsSum : 0;
  return [
    "İzleme verisi (YouTube Analytics, " + a.from + " – " + a.to + "; YouTube bu veriyi ~2-3 gün gecikmeyle işler; en az 3 izlenmeli videolar):",
    "- Kanal geneli ağırlıklı ortalama izleme oranı: " + pct(avgAll) + " (Shorts'ta döngüler yüzünden %100'ü geçebilir)",
    "İzleme oranı en yüksek videolar (seri ağırlığına esas al):",
    ...byPct.slice(0, 5).map((r) => "  • " + r.t + " — " + pct(r.avgPct) + " izlenmiş, ort. " + Math.round(r.avgSec) + " sn, " + n(r.views) + " izlenme"),
    "İzleme oranı en düşük videolar:",
    ...byPct.slice(-3).reverse().map((r) => "  • " + r.t + " — " + pct(r.avgPct) + ", ort. " + Math.round(r.avgSec) + " sn"),
    ...(gained.length ? ["Abone getiren videolar:", ...gained.map((r) => "  • " + r.t + " — +" + r.subsGained + (r.subsLost ? " / -" + r.subsLost : ""))] : []),
    ...(a.traffic.length ? ["İzleyicinin geldiği yer:", ...a.traffic.slice(0, 6).map((t) => "  • " + (TRAFFIC_TR[t.source] ?? t.source) + ": %" + Math.round((t.views / totalTraffic) * 100) + " (" + n(t.views) + ")")] : []),
    "Not: Shorts'taki 'izlemeye devam etti / kaydırıp geçti' oranı API'de yok; gerekirse Yücel'den iste.",
  ];
}
