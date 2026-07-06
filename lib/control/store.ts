// Guardrail / Kill-switch durumu (Bölüm 0.3). Kalıcı (data/control.json) +
// bellekte hızlı okuma. Kill switch AÇIKken yeni/çalışan sohbet işleri durur.
import { promises as fs } from "fs";
import path from "path";

export type Control = {
  stopped: boolean;
  stoppedAt: number | null;
  reason: string | null;
};

const FILE = path.join(process.cwd(), "data", "control.json");
let state: Control = { stopped: false, stoppedAt: null, reason: null };
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const d = JSON.parse(raw);
    if (d && typeof d.stopped === "boolean") state = d;
  } catch {
    /* dosya yok → varsayılan (durmadı) */
  }
}

// Sıcak yol (run döngüsü) — bellekten, senkron. POST başında getControl() ile
// bir kez yüklendikten sonra doğru değeri verir.
export function isStopped(): boolean {
  return state.stopped;
}

export async function getControl(): Promise<Control> {
  await ensureLoaded();
  return state;
}

export async function setControl(
  stopped: boolean,
  reason?: string,
): Promise<Control> {
  await ensureLoaded();
  state = {
    stopped,
    stoppedAt: stopped ? Date.now() : null,
    reason: stopped ? reason?.trim() || "Kill switch" : null,
  };
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* yazılamazsa bellekte yine de geçerli */
  }
  return state;
}
