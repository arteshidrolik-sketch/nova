import { getControl, setControl } from "@/lib/control/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ control: await getControl() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;
  if (op === "stop") {
    const control = await setControl(true, body?.reason as string | undefined);
    return Response.json({ control });
  }
  if (op === "resume") {
    const control = await setControl(false);
    return Response.json({ control });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
