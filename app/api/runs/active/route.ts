// Süren işler: GET → {active, runs}. Sunucudaki canlıya alma betikleri bu sayı
// 0 olana kadar bekler; böylece güncelleme çalışan işi yarıda kesmez.
import { activeRuns } from "@/lib/runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runs = activeRuns();
  return Response.json({ active: runs.length, runs }, { headers: { "Cache-Control": "no-store" } });
}
