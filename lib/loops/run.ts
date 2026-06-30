import { getLoop, type LoopRunResult } from "./registry";
import { addBriefing, setLoopState } from "./store";

export async function runLoop(id: string): Promise<LoopRunResult> {
  const def = getLoop(id);
  if (!def) throw new Error(`Bilinmeyen loop: ${id}`);

  await setLoopState(id, { lastStatus: "running" });
  try {
    const res = await def.run();
    await setLoopState(id, {
      lastStatus: "done",
      lastRunTs: Date.now(),
      lastSummary: res.summary.slice(0, 160),
    });
    await addBriefing({
      id: crypto.randomUUID(),
      ts: Date.now(),
      loopId: id,
      loopName: def.name,
      content: res.summary,
      taskId: res.taskId,
    });
    return res;
  } catch (e) {
    await setLoopState(id, { lastStatus: "failed", lastRunTs: Date.now() });
    throw e;
  }
}
