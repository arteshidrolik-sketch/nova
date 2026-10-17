// Mağaza durumu (salt okuma): GET ?scope=<proje> → {summary} · PUT ?scope=<proje> → şimdi ölç
import { measureStores, storeSummary } from "@/lib/stores/status";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  return Response.json({ summary: await storeSummary(scope) });
}

export async function PUT(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  try {
    const snap = await measureStores(scope);
    return Response.json({ ok: true, appleError: snap.appleError ?? null, playError: snap.playError ?? null, summary: await storeSummary(scope) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "ölçülemedi" }, { status: 400 });
  }
}
