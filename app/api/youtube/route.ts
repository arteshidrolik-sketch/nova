// YouTube kanal takibi:
// GET  ?scope=<proje>            → {link, latest, series, summary}
// POST ?scope=<proje> {channel}  → kanalı bağla (UC… kimliği, @adı ya da video bağlantısı) + ilk ölçüm
// PUT  ?scope=<proje>            → şimdi ölç
import { getLink, linkChannel, readSnaps, snapshot, summaryText } from "@/lib/youtube/stats";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  const link = await getLink(scope);
  if (!link) return Response.json({ link: null, hasKey: !!process.env.YOUTUBE_API_KEY });
  const snaps = await readSnaps(scope);
  const latest = snaps[snaps.length - 1] ?? null;
  return Response.json({
    link, latest, hasKey: !!process.env.YOUTUBE_API_KEY,
    series: snaps.map((s) => ({ ts: s.ts, subs: s.subs, views: s.views })),
    summary: await summaryText(scope),
  });
}

export async function POST(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { channel?: string };
  try {
    const link = await linkChannel(scope, String(body.channel ?? ""));
    const snap = await snapshot(scope);
    return Response.json({ link, latest: snap });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bağlanamadı" }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  try { return Response.json({ latest: await snapshot(scope) }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "ölçülemedi" }, { status: 400 }); }
}
