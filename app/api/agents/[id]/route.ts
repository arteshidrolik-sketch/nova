import { updateCustomAgent, deleteCustomAgent } from "@/lib/agents/custom";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const agent = await updateCustomAgent(id, body);
  if (!agent) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ agent });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteCustomAgent(id);
  return Response.json({ ok });
}
