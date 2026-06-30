import { LOOPS } from "@/lib/loops/registry";
import { loadLoopStates } from "@/lib/loops/store";

export const runtime = "nodejs";

export async function GET() {
  const states = await loadLoopStates();
  const loops = LOOPS.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    scheduleLabel: l.scheduleLabel,
    state: states[l.id] ?? {
      enabled: true,
      lastRunTs: null,
      lastStatus: "idle",
    },
  }));
  return Response.json({ loops });
}
