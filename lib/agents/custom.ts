// Kullanıcının Nova içinden oluşturduğu özel ajanlar (data/agents.json).
// Yerleşik ajanlardan (meta.ts) ayrı; bir sohbete forcedAgent=<id> ile kilitlenir.
import { promises as fs } from "fs";
import path from "path";

export type CustomAgent = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  model: string; // claude-fable-5 | claude-sonnet-5 | claude-opus-4-8
  systemPrompt: string;
  skillIds: string[]; // bu ajana yüklü beceriler
  createdAt: number;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "agents.json");

export async function loadCustomAgents(): Promise<CustomAgent[]> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

async function persist(all: CustomAgent[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function getCustomAgent(id: string): Promise<CustomAgent | undefined> {
  return (await loadCustomAgents()).find((a) => a.id === id);
}

const MODELS = new Set(["claude-fable-5", "claude-sonnet-5", "claude-opus-4-8"]);

export async function createCustomAgent(input: {
  name: string;
  description?: string;
  emoji?: string;
  color?: string;
  model?: string;
  systemPrompt: string;
  skillIds?: string[];
}): Promise<CustomAgent> {
  const all = await loadCustomAgents();
  const agent: CustomAgent = {
    id: `ca-${crypto.randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    emoji: (input.emoji || "🤖").slice(0, 4),
    color: /^#[0-9a-fA-F]{6}$/.test(input.color || "") ? (input.color as string) : "#22d3ee",
    model: input.model && MODELS.has(input.model) ? input.model : "claude-sonnet-5",
    systemPrompt: input.systemPrompt,
    skillIds: input.skillIds ?? [],
    createdAt: Date.now(),
  };
  all.push(agent);
  await persist(all);
  return agent;
}

export async function updateCustomAgent(
  id: string,
  patch: Partial<Omit<CustomAgent, "id" | "createdAt">>,
): Promise<CustomAgent | undefined> {
  const all = await loadCustomAgents();
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return undefined;
  const next = { ...all[idx], ...patch };
  if (patch.model && !MODELS.has(patch.model)) next.model = all[idx].model;
  all[idx] = next;
  await persist(all);
  return all[idx];
}

export async function deleteCustomAgent(id: string): Promise<boolean> {
  const all = await loadCustomAgents();
  const next = all.filter((a) => a.id !== id);
  if (next.length === all.length) return false;
  await persist(next);
  return true;
}
