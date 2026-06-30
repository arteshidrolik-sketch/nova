// Loop durumları + brifing çıktıları (yerel dosya).
import { promises as fs } from "fs";
import path from "path";

export type LoopState = {
  enabled: boolean;
  lastRunTs: number | null;
  lastStatus: "idle" | "running" | "done" | "failed";
  lastSummary?: string;
};

export type Briefing = {
  id: string;
  ts: number;
  loopId: string;
  loopName: string;
  content: string;
  taskId?: string;
};

const DIR = path.join(process.cwd(), "data");
const LOOPS_FILE = path.join(DIR, "loops.json");
const BRIEF_FILE = path.join(DIR, "briefings.json");

const DEFAULT: LoopState = {
  enabled: true,
  lastRunTs: null,
  lastStatus: "idle",
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export async function loadLoopStates(): Promise<Record<string, LoopState>> {
  return readJson<Record<string, LoopState>>(LOOPS_FILE, {});
}

export async function getLoopState(id: string): Promise<LoopState> {
  const all = await loadLoopStates();
  return { ...DEFAULT, ...(all[id] ?? {}) };
}

export async function setLoopState(
  id: string,
  patch: Partial<LoopState>,
): Promise<LoopState> {
  const all = await loadLoopStates();
  const next = { ...DEFAULT, ...(all[id] ?? {}), ...patch };
  all[id] = next;
  await writeJson(LOOPS_FILE, all);
  return next;
}

export async function loadBriefings(): Promise<Briefing[]> {
  const b = await readJson<Briefing[]>(BRIEF_FILE, []);
  return Array.isArray(b) ? b : [];
}

export async function addBriefing(entry: Briefing): Promise<void> {
  const all = await loadBriefings();
  all.push(entry);
  await writeJson(BRIEF_FILE, all.slice(-50)); // son 50 kayıt
}
