import { loadAudit } from "@/lib/audit/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entries = await loadAudit({
    agent: url.searchParams.get("agent") || undefined,
    tier: url.searchParams.get("tier") || undefined,
    q: url.searchParams.get("q") || undefined,
    limit: Number(url.searchParams.get("limit")) || 300,
  });
  return Response.json({ entries });
}
