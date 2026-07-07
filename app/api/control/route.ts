import { getControl, setControl } from "@/lib/control/store";
import { appendAudit } from "@/lib/audit/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ control: await getControl() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;
  if (op === "stop") {
    const control = await setControl(true, body?.reason as string | undefined);
    appendAudit({
      agent: "kullanıcı",
      action: "kill_switch",
      tier: "control",
      summary: `Tüm ajanlar DURDURULDU (${control.reason})`,
      ok: true,
    }).catch(() => {});
    return Response.json({ control });
  }
  if (op === "resume") {
    const control = await setControl(false);
    appendAudit({
      agent: "kullanıcı",
      action: "kill_switch",
      tier: "control",
      summary: "Ajanlar tekrar başlatıldı (DEVAM ET)",
      ok: true,
    }).catch(() => {});
    return Response.json({ control });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
