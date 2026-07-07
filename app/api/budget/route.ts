import { budgetStatus, setCap } from "@/lib/budget/store";
import { appendAudit } from "@/lib/audit/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ status: await budgetStatus() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.op === "setCap") {
    const cap = Number(body?.cap) || 0;
    await setCap(cap);
    appendAudit({
      agent: "kullanıcı",
      action: "budget_cap",
      tier: "control",
      summary: cap > 0 ? `Günlük token tavanı ${cap} olarak ayarlandı` : "Günlük token tavanı kaldırıldı (sınırsız)",
      ok: true,
    }).catch(() => {});
    return Response.json({ status: await budgetStatus() });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
