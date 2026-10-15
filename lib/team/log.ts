// Ekip görev kaydı (data/team-log.jsonl): müdürün her görevlendirmesi için
// uzman, seçilen/uygulanan seviye, revizyon, süre ve maliyet. Müdürün model
// seçimlerini denetlemek için (gün sonu raporu + Raporlar sekmesi).
import { promises as fs } from "fs";
import path from "path";
import { TEAM_META, type TeamRole, type Tier } from "./roles";

export type TeamLogEntry = {
  ts: number;
  day: string; // İstanbul günü, YYYY-MM-DD
  projectId: string;
  role: string;
  person: string;
  chosen: Tier; // müdürün seçtiği
  tier: Tier; // uygulanan (revizyonda otomatik yükselmiş olabilir)
  model: string;
  revision: number; // 0 = ilk teslim
  task: string; // ilk satır, kısaltılmış
  sec: number;
  input: number;
  output: number;
  costUsd: number;
  actions: number;
  artifacts: number;
};

const FILE = path.join(process.cwd(), "data", "team-log.jsonl");

export async function appendTeamLog(e: TeamLogEntry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.appendFile(FILE, JSON.stringify(e) + "\n", "utf8");
  } catch { /* kayıt yazılamazsa iş yine sürer */ }
}

export async function readTeamLog(f: { projectId?: string; day?: string; sinceDays?: number } = {}): Promise<TeamLogEntry[]> {
  let raw = "";
  try { raw = await fs.readFile(FILE, "utf8"); } catch { return []; }
  const since = f.sinceDays ? Date.now() - f.sinceDays * 864e5 : 0;
  const out: TeamLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as TeamLogEntry;
      if (f.projectId && e.projectId !== f.projectId) continue;
      if (f.day && e.day !== f.day) continue;
      if (e.ts < since) continue;
      out.push(e);
    } catch { /* bozuk satır atlanır */ }
  }
  return out;
}

// Seçim denetimi: şüpheli kararları işaretler (kesin yargı değil, ipucu).
// Bir görev = aynı proje+uzman için ilk teslim ve ardından gelen revizyonlar.
export function flagEntries(entries: TeamLogEntry[]): string[] {
  const flags: string[] = [];
  const tasks: TeamLogEntry[][] = [];
  const open: Record<string, TeamLogEntry[]> = {};
  for (const e of [...entries].sort((a, b) => a.ts - b.ts)) {
    const k = e.projectId + "|" + e.role;
    if (e.revision === 0 || !open[k]) { open[k] = [e]; tasks.push(open[k]); }
    else open[k].push(e);
  }
  for (const t of tasks) {
    const first = t[0];
    const revs = t.length - 1;
    const label = `${first.person} (${TEAM_META[first.role as TeamRole]?.name ?? first.role}) — "${first.task.slice(0, 60)}"`;
    if (first.chosen === "hafif" && revs >= 2) flags.push(`⬆️ ${label}: hafif seçildi ama ${revs} revizyon gerekti → standart daha uygun olabilirdi`);
    if (first.chosen === "agir" && revs === 0 && first.sec < 40 && first.actions <= 1) flags.push(`⬇️ ${label}: ağır (Opus) seçildi ama iş ${first.sec} sn'de, revizyonsuz bitti → daha ucuz seviye yetebilirdi`);
    if (t.some((e) => e.tier !== e.chosen)) flags.push(`↗️ ${label}: revizyonda takıldı, seviye otomatik yükseltildi`);
  }
  return flags;
}

const TIER_TR: Record<Tier, string> = { hafif: "Haiku", standart: "Sonnet", agir: "Opus" };

// Rapora eklenecek deterministik özet (modelden bağımsız, rakamlar kayıttan)
export function summarizeTeamLog(entries: TeamLogEntry[]): string {
  if (!entries.length) return "";
  const cost = entries.reduce((a, e) => a + e.costUsd, 0);
  const by: Record<string, number> = {};
  for (const e of entries) by[TIER_TR[e.tier]] = (by[TIER_TR[e.tier]] ?? 0) + 1;
  const revs = entries.filter((e) => e.revision > 0).length;
  const lines = [
    `🧮 Model kararları: ${entries.length} görev çalışması (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}), ${revs} revizyon, tahmini maliyet $${cost.toFixed(2)}`,
  ];
  const flags = flagEntries(entries);
  lines.push(...(flags.length ? flags : ["✅ Şüpheli seviye seçimi yok."]));
  return lines.join("\n");
}
