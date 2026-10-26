// RunPod pod otomasyonu: "Üret"e basınca pod'u başlat, hazır olunca üret, boşta kalınca durdur.
// Soğuk başlatma ~2-3 dk sürer (pod uyanır + start-all.sh + ComfyUI). Sonraki üretimler hızlı.
import { comfyUp, connect, execOnPod, ollamaStatus, readCfg, writeCfg } from "./tunnel";

const BASE = "https://rest.runpod.io/v1";
const POD_ID = process.env.NOVA_RUNPOD_POD_ID || "";
const IDLE_MS = (Number(process.env.NOVA_POD_IDLE_MIN) || 10) * 60_000;

function key(): string { return process.env.RUNPOD_API_KEY || ""; }
export function podAutomationReady(): boolean { return !!key() && !!POD_ID; }

async function api(path: string, method: "GET" | "POST" = "GET"): Promise<Record<string, unknown> | null> {
  if (!key()) return null;
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const t = await r.json().catch(() => ({})); return { _status: r.status, error: (t as { error?: string }).error ?? "" }; }
    return (await r.json()) as Record<string, unknown>;
  } catch { return null; }
}

type PodInfo = { status: string; host: string; sshPort: number };
export async function podStatus(): Promise<PodInfo | null> {
  const j = await api(`/pods/${POD_ID}`);
  if (!j || j._status) return null;
  const pm = (j.portMappings ?? {}) as Record<string, number>;
  return { status: String(j.desiredStatus ?? ""), host: String(j.publicIp ?? ""), sshPort: Number(pm["22"]) || 0 };
}

// Başlatmayı dene; kapasite yoksa anlaşılır hata döndür (null = başarılı).
async function startPod(): Promise<string | null> {
  const j = await api(`/pods/${POD_ID}/start`, "POST");
  if (!j) return "RunPod'a ulaşılamadı";
  if (j._status) {
    const msg = String((j.error as string) || "");
    if (/not enough free GPUs|capacity/i.test(msg)) return "Şu an boş GPU yok (RunPod kapasite). Birkaç dakika sonra tekrar dene.";
    return `Pod başlatılamadı (${j._status})`;
  }
  return null;
}
export async function stopPod(): Promise<void> { await api(`/pods/${POD_ID}/stop`, "POST"); }

// Son kullanım anı — boşta durdurma için.
let lastActivity = Date.now();
let sweeper: ReturnType<typeof setInterval> | null = null;
export function touchPod(): void {
  lastActivity = Date.now();
  if (!sweeper && podAutomationReady()) {
    sweeper = setInterval(async () => {
      if (Date.now() - lastActivity < IDLE_MS) return;
      const s = await podStatus();
      if (s && s.status === "RUNNING") { await stopPod().catch(() => {}); lastActivity = Date.now(); }
    }, 60_000);
    if (typeof sweeper.unref === "function") sweeper.unref();
  }
}

// Pod'u üretime hazır hale getir: gerekiyorsa başlat, SSH'ı bağla, start-all.sh çalıştır, ComfyUI'yi bekle.
// onLog ile ilerleme bildirilir. Hazır olunca döner; olmazsa Error fırlatır.
export async function ensurePodReady(onLog?: (s: string) => void): Promise<void> {
  touchPod();
  if (!podAutomationReady()) return; // otomasyon kapalı — mevcut köprüye güven
  const log = (s: string) => onLog?.(s);

  let st = await podStatus();
  if (!st) throw new Error("RunPod'a ulaşılamadı (API anahtarı?)");

  if (st.status !== "RUNNING") {
    log("Pod başlatılıyor…");
    const e = await startPod();
    if (e) throw new Error(e);
    // RUNNING + SSH portu gelene kadar bekle (~2 dk)
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      st = await podStatus();
      if (st && st.status === "RUNNING" && st.host && st.sshPort) break;
    }
    if (!st || st.status !== "RUNNING" || !st.sshPort) throw new Error("Pod başlatılamadı (zaman aşımı)");
  }

  // SSH adresi değişmiş olabilir → köprüyü güncelle
  const cfg = await readCfg();
  if (!cfg || cfg.host !== st.host || cfg.port !== st.sshPort) {
    await writeCfg({ host: st.host, port: st.sshPort, comfyUrl: cfg?.comfyUrl, updatedAt: Date.now() });
    await connect(st.host, st.sshPort);
  }

  // ComfyUI zaten ayakta mı?
  if (await comfyUp()) return;

  // Değilse start-all.sh çalıştır ve bekle
  log("Modeller yükleniyor… (~1-2 dk)");
  await execOnPod("bash /workspace/start-all.sh");
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    if (await connectIfNeeded(st.host, st.sshPort)) { /* köprü canlı */ }
    if (await comfyUp()) return;
  }
  throw new Error("ComfyUI hazır olmadı (zaman aşımı)");
}

// Köprü düşmüşse tekrar kur (başlatma sırasında SSH yeni gelebilir).
async function connectIfNeeded(host: string, port: number): Promise<boolean> {
  const [o, c] = await Promise.all([ollamaStatus(), comfyUp()]);
  if (o.up || c) return true;
  await connect(host, port).catch(() => {});
  return false;
}
