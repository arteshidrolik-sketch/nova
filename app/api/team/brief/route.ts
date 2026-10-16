// Proje kimliği: GET ?scope=<proje> → {brief} · PUT ?scope=<proje> {brief} → kaydet
import { getBrief, setBrief } from "@/lib/team/brief";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  return Response.json({ brief: await getBrief(scope) });
}

export async function PUT(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { brief?: string };
  await setBrief(scope, String(body.brief ?? ""));
  return Response.json({ ok: true });
}
