// Proje token sayacı (data/project-usage.json): projenin ömrü boyunca her API
// çağrısının tokenları ve USD karşılığı, role göre (müdür, uzmanlar, doğrudan).
// Ajan performans panelinin üstündeki sabit özet buradan beslenir.
import { promises as fs } from "fs";
import path from "path";
import { priceOf } from "@/lib/budget/store";

export type UsageRole = "manager" | "research" | "coder" | "marketing" | "direct";
export type UsageTotals = { input: number; cacheWrite: number; cacheRead: number; output: number; usd: number; calls: number };
type ProjectUsage = { since: number; roles: Partial<Record<UsageRole, UsageTotals>> };
type State = Record<string, ProjectUsage>;

const FILE = path.join(process.cwd(), "data", "project-usage.json");
let state: State | null = null;
let chain: Promise<void> = Promise.resolve(); // yazmaları sıraya koy (yarış olmasın)

async function load(): Promise<State> {
  if (state) return state;
  try { state = JSON.parse(await fs.readFile(FILE, "utf8")) as State; } catch { state = {}; }
  return state;
}

export const emptyTotals = (): UsageTotals => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, calls: 0 });

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function recordProjectUsage(projectId: string | undefined, role: UsageRole, model: string, u: Usage | null | undefined): void {
  if (!projectId || !u) return;
  chain = chain.then(async () => {
    const s = await load();
    const p = (s[projectId] ??= { since: Date.now(), roles: {} });
    const t = (p.roles[role] ??= emptyTotals());
    const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
    const cw = u.cache_creation_input_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0;
    const [pi, po] = priceOf(model);
    t.input += inp; t.output += out; t.cacheWrite += cw; t.cacheRead += cr; t.calls++;
    t.usd += (inp * pi + cw * pi * 1.25 + cr * pi * 0.1 + out * po) / 1e6;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(s), "utf8");
  }).catch(() => {});
}

export async function getProjectUsage(projectId: string) {
  await chain;
  const p = (await load())[projectId];
  const roles = p?.roles ?? {};
  const total = emptyTotals();
  for (const t of Object.values(roles)) {
    if (!t) continue;
    total.input += t.input; total.output += t.output; total.cacheWrite += t.cacheWrite;
    total.cacheRead += t.cacheRead; total.usd += t.usd; total.calls += t.calls;
  }
  return { since: p?.since ?? null, total, roles };
}
