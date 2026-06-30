import {
  deleteRelease,
  getRelease,
  updateRelease,
  type ReleaseStatus,
} from "@/lib/releases/store";
import { analyzeRejection, generateReleaseContent } from "@/lib/releases/generate";
import { createTask } from "@/lib/tasks/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUSES: ReleaseStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "live",
  "rejected",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;

  const rel = await getRelease(id);
  if (!rel) return Response.json({ error: "not_found" }, { status: 404 });

  // İçerik üret (salt-okuma, GO gerekmez)
  if (op === "generate") {
    try {
      const content = await generateReleaseContent(rel, String(body?.notes ?? ""));
      const updated = await updateRelease(id, { content });
      return Response.json({ release: updated });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "generate_failed" },
        { status: 500 },
      );
    }
  }

  // Durum / store linki / red nedeni güncelle
  if (op === "status") {
    const status = body?.status as ReleaseStatus;
    if (!STATUSES.includes(status)) {
      return Response.json({ error: "bad_status" }, { status: 400 });
    }
    const updated = await updateRelease(id, {
      status,
      storeUrl: body?.storeUrl ? String(body.storeUrl) : rel.storeUrl,
      rejectionReason:
        status === "rejected"
          ? String(body?.rejectionReason ?? rel.rejectionReason ?? "")
          : rel.rejectionReason,
    });
    return Response.json({ release: updated });
  }

  // Reddi analiz et → düzeltme planı + GO-onaylı görev
  if (op === "analyzeRejection") {
    const reason = String(body?.rejectionReason ?? rel.rejectionReason ?? "");
    if (!reason) return Response.json({ error: "no_reason" }, { status: 400 });
    try {
      const fixPlan = await analyzeRejection(rel, reason);
      const updated = await updateRelease(id, {
        status: "rejected",
        rejectionReason: reason,
        fixPlan,
      });
      const task = await createTask({
        agent: "releaseStore",
        actionType: "write_file",
        title: `Dosya yaz: workspace/${rel.project}-${rel.version}-duzeltme.md`,
        payload: {
          path: `${rel.project}-${rel.version}-duzeltme.md`,
          content: fixPlan,
        },
        dangerous: true,
      });
      return Response.json({ release: updated, taskId: task.id });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "analyze_failed" },
        { status: 500 },
      );
    }
  }

  if (op === "delete") {
    await deleteRelease(id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "bad_op" }, { status: 400 });
}
