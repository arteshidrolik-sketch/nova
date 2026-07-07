// Beceri (skill) deposu — ajanlara atanan bilgi/talimat paketleri.
import { promises as fs } from "fs";
import path from "path";
import type { AgentKey } from "@/lib/agents/meta";

export type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  agentKeys: AgentKey[];
  source?: string;
  createdAt: number;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "skills.json");

export async function loadSkills(): Promise<Skill[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function persist(all: Skill[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function getSkillsForAgent(agent: AgentKey): Promise<Skill[]> {
  return (await loadSkills()).filter((s) => s.agentKeys.includes(agent));
}

export async function getSkillsByIds(ids: string[]): Promise<Skill[]> {
  if (!ids.length) return [];
  const set = new Set(ids);
  return (await loadSkills()).filter((s) => set.has(s.id));
}

export async function createSkill(input: {
  name: string;
  description?: string;
  content: string;
  agentKeys: AgentKey[];
  source?: string;
}): Promise<Skill> {
  const all = await loadSkills();
  const skill: Skill = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    content: input.content,
    agentKeys: input.agentKeys,
    source: input.source,
    createdAt: Date.now(),
  };
  all.push(skill);
  await persist(all);
  return skill;
}

export async function updateSkill(
  id: string,
  patch: Partial<Omit<Skill, "id" | "createdAt">>,
): Promise<Skill | undefined> {
  const all = await loadSkills();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch };
  await persist(all);
  return all[idx];
}

export async function deleteSkill(id: string): Promise<boolean> {
  const all = await loadSkills();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await persist(next);
  return true;
}
