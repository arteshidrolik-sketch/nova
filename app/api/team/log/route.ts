// Ekip görev kaydı: GET /api/team/log?scope=<proje kimliği>&days=30
// Müdürün model seçimleri, revizyonlar, süre ve tahmini maliyet + şüpheli seçim işaretleri.
import { flagEntries, readTeamLog } from "@/lib/team/log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const days = Math.min(365, Math.max(1, Number(sp.get("days")) || 30));
  const entries = await readTeamLog({ projectId: sp.get("scope") ?? undefined, sinceDays: days });
  const costUsd = Math.round(entries.reduce((a, e) => a + e.costUsd, 0) * 100) / 100;
  return Response.json({ entries: entries.reverse(), flags: flagEntries(entries), costUsd });
}
