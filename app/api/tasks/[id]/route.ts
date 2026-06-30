import { getTask, updateTask } from "@/lib/tasks/store";
import { actionTitle, executeAction } from "@/lib/tools/actions";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;

  const task = await getTask(id);
  if (!task) return Response.json({ error: "not_found" }, { status: 404 });

  // İptal
  if (op === "reject") {
    const t = await updateTask(id, { status: "rejected" });
    return Response.json({ task: t });
  }

  // Düzelt (sadece bekleyen görevde)
  if (op === "update") {
    if (task.status !== "proposed") {
      return Response.json({ error: "not_proposed" }, { status: 400 });
    }
    const payload = {
      ...task.payload,
      ...((body?.payload as Record<string, unknown>) ?? {}),
    };
    const t = await updateTask(id, {
      payload,
      title: actionTitle(task.actionType, payload),
    });
    return Response.json({ task: t });
  }

  // GO (onayla + çalıştır)
  if (op === "approve") {
    if (task.status !== "proposed") {
      return Response.json({ error: "not_proposed" }, { status: 400 });
    }
    await updateTask(id, { status: "running" });
    try {
      const result = await executeAction(task.actionType, task.payload);
      const t = await updateTask(id, { status: "done", result, error: undefined });
      return Response.json({ task: t });
    } catch (e) {
      const t = await updateTask(id, {
        status: "failed",
        error: e instanceof Error ? e.message : "Bilinmeyen hata",
      });
      return Response.json({ task: t });
    }
  }

  return Response.json({ error: "bad_op" }, { status: 400 });
}
