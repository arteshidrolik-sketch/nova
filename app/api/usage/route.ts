// Nova geneli harcama: GET /api/usage → tüm zamanlar / bu ay / bugün (token + USD)
// Tüm projeler ve ekip dışı işler (sohbet, ekip, rapor, fatura okuma) dahil.
import { usageTotals } from "@/lib/budget/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await usageTotals());
}
