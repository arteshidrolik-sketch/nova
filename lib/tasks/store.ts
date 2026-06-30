// Görev (task) deposu — yerel dosya. GO-onaylı aksiyonların durumunu tutar.
import { promises as fs } from "fs";
import path from "path";
import type { AgentKey } from "@/lib/agents/meta";

export type TaskStatus =
  | "proposed"
  | "running"
  | "done"
  | "rejected"
  | "failed";

export type Task = {
  id: string;
  ts: number;
  updatedAt: number;
  status: TaskStatus;
  agent: AgentKey;
  actionType: string;
  title: string;
  payload: Record<string, unknown>;
  dangerous: boolean;
  result?: string;
  error?: string;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "tasks.json");

export async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function persist(all: Task[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function createTask(input: {
  agent: AgentKey;
  actionType: string;
  title: string;
  payload: Record<string, unknown>;
  dangerous: boolean;
}): Promise<Task> {
  const all = await loadTasks();
  const now = Date.now();
  const task: Task = {
    id: crypto.randomUUID(),
    ts: now,
    updatedAt: now,
    status: "proposed",
    agent: input.agent,
    actionType: input.actionType,
    title: input.title,
    payload: input.payload,
    dangerous: input.dangerous,
  };
  all.push(task);
  await persist(all);
  return task;
}

export async function getTask(id: string): Promise<Task | undefined> {
  return (await loadTasks()).find((t) => t.id === id);
}

export async function updateTask(
  id: string,
  patch: Partial<Task>,
): Promise<Task | undefined> {
  const all = await loadTasks();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
  await persist(all);
  return all[idx];
}
