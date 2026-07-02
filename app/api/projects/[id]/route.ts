import {
  getProject,
  removeProject,
  setActive,
  setProjectConversation,
} from "@/lib/projects/store";
import {
  createConversation,
  getConversation,
  updateConversation,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;

  if (op === "activate") {
    await setActive(id);
    // Projeye ait sohbeti aç; yoksa (veya silinmişse) proje adıyla oluştur
    const proj = await getProject(id);
    let convId = proj?.conversationId;
    if (convId && !(await getConversation(convId))) convId = undefined;
    if (!convId) {
      const conv = await createConversation();
      await updateConversation(conv.id, { title: proj?.name || "Proje" });
      await setProjectConversation(id, conv.id);
      convId = conv.id;
    }
    return Response.json({ ok: true, conversationId: convId });
  }
  if (op === "remove") {
    await removeProject(id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
