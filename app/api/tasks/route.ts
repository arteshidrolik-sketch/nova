import { loadTasks } from "@/lib/tasks/store";

export const runtime = "nodejs";

export async function GET() {
  const tasks = await loadTasks();
  // Bekleyenler önce, sonra en yeni güncellenen
  const order: Record<string, number> = {
    proposed: 0,
    running: 1,
    failed: 2,
    done: 3,
    rejected: 4,
  };
  tasks.sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      b.updatedAt - a.updatedAt,
  );
  return Response.json({ tasks });
}
