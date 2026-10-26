// Stüdyo: Nova sunucusundan RunPod pod'una SSH köprüsü.
// Pod'daki Ollama (11434) ve ComfyUI (8188) konteynerin localhost'una yönlendirilir;
// böylece pod'da port açmaya gerek kalmaz (reset olmaz) ve servisler dışarıya açılmaz.
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { promises as fs } from "fs";

const DIR = path.join(process.cwd(), "data");
const KEY = path.join(DIR, "pod_key");
const CFG = path.join(DIR, "studio.json");

export type StudioCfg = { host: string; port: number; comfyUrl?: string; updatedAt: number };

export async function readCfg(): Promise<StudioCfg | null> {
  try { return JSON.parse(await fs.readFile(CFG, "utf8")); } catch { return null; }
}
export async function writeCfg(c: StudioCfg): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(CFG, JSON.stringify(c));
}

let child: ChildProcess | null = null;
let current = ""; // host:port — açık köprünün hedefi

export function tunnelTarget(): string { return child && !child.killed ? current : ""; }

// Köprüyü (yeniden) kur: eskiyi kapat, yeni ssh -N -L başlat.
export async function connect(host: string, port: number): Promise<void> {
  await fs.chmod(KEY, 0o600).catch(() => {});
  if (child && !child.killed) { try { child.kill("SIGKILL"); } catch { /* yoksay */ } child = null; }
  const args = [
    "-N", "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-i", KEY, "-p", String(port),
    "-L", "127.0.0.1:11434:127.0.0.1:11434",
    "-L", "127.0.0.1:8188:127.0.0.1:8188",
    `root@${host}`,
  ];
  const c = spawn("ssh", args, { stdio: "ignore", detached: false });
  child = c; current = `${host}:${port}`;
  c.on("exit", () => { if (child === c) { child = null; } });
  // bağlantı kurulsun diye kısa bekleme
  await new Promise((r) => setTimeout(r, 1500));
}

export function disconnect(): void {
  if (child && !child.killed) { try { child.kill("SIGKILL"); } catch { /* yoksay */ } }
  child = null; current = "";
}

// Köprü üzerinden Ollama'ya ulaşılıyor mu + modeller.
export async function ollamaStatus(): Promise<{ up: boolean; models: string[] }> {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { up: false, models: [] };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { up: true, models: (j.models ?? []).map((m) => m.name) };
  } catch { return { up: false, models: [] }; }
}

// ComfyUI'ye (8188) ulaşılıyor mu.
export async function comfyUp(): Promise<boolean> {
  try { const r = await fetch("http://127.0.0.1:8188/", { signal: AbortSignal.timeout(4000) }); return r.ok; }
  catch { return false; }
}

// Pod bilgisi kayıtlıysa köprüyü kendiliğinden kur (sunucu yeniden başladığında).
export async function ensureFromCfg(): Promise<void> {
  if (tunnelTarget()) return;
  const c = await readCfg();
  if (c?.host && c?.port) await connect(c.host, c.port).catch(() => {});
}
