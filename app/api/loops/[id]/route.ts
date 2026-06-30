import { getLoop } from "@/lib/loops/registry";
import { getLoopState, setLoopState } from "@/lib/loops/store";
import { runLoop } from "@/lib/loops/run";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;

  if (!getLoop(id)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (op === "toggle") {
    const cur = await getLoopState(id);
    const state = await setLoopState(id, { enabled: !cur.enabled });
    return Response.json({ state });
  }

  if (op === "run") {
    try {
      const result = await runLoop(id);
      const state = await getLoopState(id);
      return Response.json({ result, state });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "run_failed" },
        { status: 500 },
      );
    }
  }

  return Response.json({ error: "bad_op" }, { status: 400 });
}
