import {
  deleteConversation,
  getConversation,
  updateConversation,
  type ConvMessage,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conversation = await getConversation(id);
  if (!conversation)
    return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ conversation });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { title?: string; messages?: ConvMessage[] } = {};
  if (typeof body?.title === "string") patch.title = body.title;
  if (Array.isArray(body?.messages)) patch.messages = body.messages;

  const conversation = await updateConversation(id, patch);
  if (!conversation)
    return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ conversation });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteConversation(id);
  return Response.json({ ok });
}
