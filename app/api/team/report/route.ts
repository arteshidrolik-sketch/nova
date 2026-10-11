// Gün sonu raporunu elle tetikle (test / "şimdi rapor ver"): POST /api/team/report
import { runDailyReports } from "@/lib/team/report";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const r = await runDailyReports(undefined, false);
  return Response.json(r);
}
