// Müfettiş deposu: ajan performans denetiminin verdiktleri ve bekleyen kuyruğu.
// İŞ KALİTESİNİ müdür denetler; müfettiş yalnız OPERASYONU puanlar: hız, teslim,
// ilgililik, verim, araç disiplini. Sayaçlar team-log'dan (ölçülür); ilgililik +
// sert verdikt yerel sansürsüz modelden (kuyruk, pod açıkken işlenir).
import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "inspector");
const VERDICTS = path.join(DIR, "verdicts.jsonl"); // her koşumun verdikti (sert metrik hemen, soft sonra)
const QUEUE = path.join(DIR, "queue.jsonl"); // LLM yargısı bekleyen paketler (görev+teslim metniyle)

export type RunMetrics = {
  sec: number; input: number; output: number;
  actions: number; artifacts: number; failed: boolean; errors: number;
};
// Müdürün müfettişe verdiği denetim paketi (LLM yargısı için; işlenince kuyruktan silinir)
export type RunPackage = {
  id: string; ts: number; projectId: string; role: string; person: string;
  tier: string; model: string; metrics: RunMetrics;
  task: string; criteria: string; delivery: string; // tam metinler — ilgililik yargısı için
};
export type Dims = { hiz: number; teslim: number; verim: number; disiplin: number; ilgililik: number | null };
export type Verdict = {
  id: string; ts: number; projectId: string; role: string; person: string;
  tier: string; model: string; metrics: RunMetrics;
  task: string; dims: Dims; total: number; judged: boolean; verdikt?: string;
};

async function readJsonl<T>(file: string): Promise<T[]> {
  let raw = "";
  try { raw = await fs.readFile(file, "utf8"); } catch { return []; }
  const out: T[] = [];
  for (const line of raw.split("\n")) { if (!line.trim()) continue; try { out.push(JSON.parse(line) as T); } catch { /* bozuk satır */ } }
  return out;
}
async function writeJsonl<T>(file: string, rows: T[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}
async function appendJsonl<T>(file: string, row: T): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.appendFile(file, JSON.stringify(row) + "\n", "utf8");
}

export async function enqueue(pkg: RunPackage): Promise<void> {
  const q = await readJsonl<RunPackage>(QUEUE);
  q.push(pkg);
  await writeJsonl(QUEUE, q.slice(-500)); // kuyruk sınırsız büyümesin
}
export async function readQueue(): Promise<RunPackage[]> { return readJsonl<RunPackage>(QUEUE); }
export async function setQueue(rows: RunPackage[]): Promise<void> { await writeJsonl(QUEUE, rows); }

// İş sonu görüşmesi: müfettiş durumu söyler, müdür cevap verir, aksiyon alınır.
export type Meeting = {
  id: string; ts: number; projectId: string;
  kind: "sert" | "dobra"; // sert = metrik bazlı (iş biter bitmez) · dobra = sansürsüz model verdiktleri işlenince
  mufettis: string; mudurAdi: string; mudur: string;
  aksiyon?: string; briefNotu?: string;
};
const MEETINGS = path.join(DIR, "meetings.jsonl");
export async function appendMeeting(m: Meeting): Promise<void> { await appendJsonl(MEETINGS, m); }
export async function readMeetings(projectId?: string, limit = 20): Promise<Meeting[]> {
  const all = await readJsonl<Meeting>(MEETINGS);
  const f = projectId ? all.filter((m) => m.projectId === projectId) : all;
  return f.slice(-limit);
}

export async function appendVerdict(v: Verdict): Promise<void> { await appendJsonl(VERDICTS, v); }
export async function readVerdicts(limit = 2000): Promise<Verdict[]> {
  const all = await readJsonl<Verdict>(VERDICTS);
  return all.slice(-limit);
}
// Bir koşumun verdiktini (LLM yargısı gelince) güncelle: dosyayı yeniden yaz.
export async function updateVerdict(id: string, patch: Partial<Verdict>): Promise<void> {
  const all = await readJsonl<Verdict>(VERDICTS);
  let changed = false;
  for (const v of all) if (v.id === id) { Object.assign(v, patch); changed = true; }
  if (changed) await writeJsonl(VERDICTS, all.slice(-5000));
}

// Ajan bazında skor tablosu (verdiktlerden hesaplanır).
export type AgentScore = {
  role: string; person: string; runs: number; avg: number;
  dims: { hiz: number; teslim: number; verim: number; disiplin: number; ilgililik: number | null };
  pending: number; // LLM yargısı bekleyen koşum sayısı
};
function avg(ns: number[]): number { return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0; }
export function scoreboard(verdicts: Verdict[]): AgentScore[] {
  const byRole: Record<string, Verdict[]> = {};
  for (const v of verdicts) (byRole[v.role] ??= []).push(v);
  const rows: AgentScore[] = [];
  for (const [role, vs] of Object.entries(byRole)) {
    const ilg = vs.map((v) => v.dims.ilgililik).filter((x): x is number => typeof x === "number");
    rows.push({
      role, person: vs[vs.length - 1].person, runs: vs.length, avg: avg(vs.map((v) => v.total)),
      dims: {
        hiz: avg(vs.map((v) => v.dims.hiz)), teslim: avg(vs.map((v) => v.dims.teslim)),
        verim: avg(vs.map((v) => v.dims.verim)), disiplin: avg(vs.map((v) => v.dims.disiplin)),
        ilgililik: ilg.length ? avg(ilg) : null,
      },
      pending: vs.filter((v) => !v.judged).length,
    });
  }
  return rows.sort((a, b) => b.avg - a.avg);
}
