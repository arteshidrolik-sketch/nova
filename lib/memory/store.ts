// Yerel dosya tabanlı hafıza. Anahtar kelime + tazelik ile basit getirme.
// (İleride Supabase + pgvector + embeddings ile semantic search'e yükseltilebilir.)
import { promises as fs } from "fs";
import path from "path";

export type Memory = {
  id: string;
  ts: number; // ms epoch
  summary: string;
  tags: string[];
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "memories.json");

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-zçğıöşü0-9]+/g) || []).filter(
    (w) => w.length > 2,
  );
}

export async function loadMemories(): Promise<Memory[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function saveMemory(input: {
  summary: string;
  tags?: string[];
}): Promise<Memory> {
  await fs.mkdir(DIR, { recursive: true });
  const all = await loadMemories();
  const mem: Memory = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    summary: input.summary.trim(),
    tags: input.tags ?? [],
  };
  all.push(mem);
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  return mem;
}

export async function searchMemories(
  query: string,
  limit = 3,
): Promise<Memory[]> {
  const all = await loadMemories();
  if (all.length === 0) return [];

  const q = new Set(tokenize(query));
  const scored = all.map((m) => {
    const words = new Set(tokenize(`${m.summary} ${m.tags.join(" ")}`));
    let overlap = 0;
    for (const w of q) if (words.has(w)) overlap++;
    const ageDays = (Date.now() - m.ts) / 86_400_000;
    const recency = 1 / (1 + ageDays);
    return { m, score: overlap * 2 + recency };
  });

  return scored
    .filter((s) => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}
