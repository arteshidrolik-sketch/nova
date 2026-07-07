// Denetim defteri (Bölüm 1.6) — append-only eylem kaydı. JSONL: her satır bir
// olay, sadece eklenir (silinmez). "Nova ne yaptı?" tek dosyadan yanıtlanır.
import { promises as fs } from "fs";
import path from "path";

export type AuditTier = "auto" | "approval" | "control";
export type AuditEntry = {
  id: string;
  ts: number;
  agent: string;
  model?: string;
  action: string; // write_project_file, run_command, git_commit_push, kill_switch, budget_cap…
  tier: AuditTier;
  summary: string;
  ok: boolean;
  result?: string;
  project?: string;
};

const FILE = path.join(process.cwd(), "data", "audit.jsonl");
const READ_MAX = 4000; // UI'a en fazla bu kadar son kayıt döner

export async function appendAudit(e: {
  agent: string;
  model?: string;
  action: string;
  tier: AuditTier;
  summary: string;
  ok: boolean;
  result?: string;
  project?: string;
  ts?: number;
}): Promise<void> {
  try {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      ts: e.ts ?? Date.now(),
      agent: e.agent || "system",
      model: e.model,
      action: e.action,
      tier: e.tier,
      summary: (e.summary || "").replace(/\s+/g, " ").slice(0, 300),
      ok: e.ok,
      result: e.result ? String(e.result).replace(/\s+/g, " ").slice(0, 300) : undefined,
      project: e.project,
    };
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    // appendFile atomiktir → eşzamanlı yazımlar yarışmaz (append-only)
    await fs.appendFile(FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* audit hatası ana akışı bozmamalı */
  }
}

// En yeni önce; opsiyonel filtreler.
export async function loadAudit(filter?: {
  agent?: string;
  tier?: string;
  q?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  let lines: string[];
  try {
    const raw = await fs.readFile(FILE, "utf8");
    lines = raw.split("\n").filter(Boolean).slice(-READ_MAX);
  } catch {
    return [];
  }
  let out: AuditEntry[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* bozuk satır atla */
    }
  }
  out.reverse(); // en yeni önce
  if (filter?.agent) out = out.filter((e) => e.agent === filter.agent);
  if (filter?.tier) out = out.filter((e) => e.tier === filter.tier);
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    out = out.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.project || "").toLowerCase().includes(q),
    );
  }
  return out.slice(0, Math.min(filter?.limit || 300, 1000));
}
