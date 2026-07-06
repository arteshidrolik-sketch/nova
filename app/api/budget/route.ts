import { budgetStatus, setCap } from "@/lib/budget/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ status: await budgetStatus() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.op === "setCap") {
    await setCap(Number(body?.cap) || 0);
    return Response.json({ status: await budgetStatus() });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
