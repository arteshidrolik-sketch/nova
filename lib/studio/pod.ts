// RunPod pod otomasyonu: "Üret"e basınca pod'u başlat, hazır olunca üret, boşta kalınca durdur.
// Soğuk başlatma ~2-3 dk sürer (pod uyanır + start-all.sh + ComfyUI). Sonraki üretimler hızlı.
import { promises as fs } from "fs";
import path from "path";
import { comfyUp, connect, execOnPod, ollamaStatus, readCfg, writeCfg } from "./tunnel";

const BASE = "https://rest.runpod.io/v1";
const IDLE_MS = (Number(process.env.NOVA_POD_IDLE_MIN) || 10) * 60_000;
// Emniyet kemeri: aktivite takibi ne derse desin, pod bu süreden uzun KESİNTİSİZ çalışamaz.
// (2026-10-27 kazası: deploy nöbetçiyi öldürdü, pod bakiye bitene kadar çalıştı.)
const MAX_MS = (Number(process.env.NOVA_POD_MAX_MIN) || 240) * 60_000;
const ACT_FILE = path.join(process.cwd(), "data", "studio", "pod-activity.json"); // deploy'a dayanıklı sayaç
const PODID_FILE = path.join(process.cwd(), "data", "studio", "pod-id.json"); // çalışır-anda değişen pod ID (otomatik yeniden deploy)

// Taze pod açmak için deploy parametreleri (env ile değiştirilebilir, aksi halde bilinen kurulum).
const DEPLOY = {
  gpu: process.env.NOVA_RUNPOD_GPU || "NVIDIA A40",
  image: process.env.NOVA_RUNPOD_IMAGE || "runpod/pytorch:1.4.1-cu1281-torch280-ubuntu2404",
  volume: process.env.NOVA_RUNPOD_VOLUME || "iff2caze3b",
  dc: process.env.NOVA_RUNPOD_DC || "CA-MTL-1",
  disk: Number(process.env.NOVA_RUNPOD_DISK_GB) || 50,
  // nova-deploy açık anahtarı (gizli değil) — pod'a SSH için PUBLIC_KEY env'i
  pubkey: process.env.NOVA_RUNPOD_PUBKEY || "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO0t75LjxpwyTCAYLifwvzZ2lqRoPjMUR2JjKYLDbtPf nova-deploy",
};

function key(): string { return process.env.RUNPOD_API_KEY || ""; }
// Otomasyon hazır: API anahtarı var (pod ID yoksa taze deploy edilir).
export function podAutomationReady(): boolean { return !!key(); }

// Pod ID çalışır-anda dosyadan okunur (otomatik yeniden deploy ID'yi değiştirir);
// dosya yoksa env'den başlar. Böylece kapasite yüzünden yeni pod açılınca
// konteyner yeniden başlatmaya / .env düzenlemeye gerek kalmaz.
let podIdCache = "";
async function getPodId(): Promise<string> {
  if (podIdCache) return podIdCache;
  try { const j = JSON.parse(await fs.readFile(PODID_FILE, "utf8")) as { id?: string }; if (j.id) return (podIdCache = j.id); } catch { /* dosya yok */ }
  return (podIdCache = process.env.NOVA_RUNPOD_POD_ID || "");
}
async function savePodId(id: string): Promise<void> {
  podIdCache = id;
  try { await fs.mkdir(path.dirname(PODID_FILE), { recursive: true }); await fs.writeFile(PODID_FILE, JSON.stringify({ id, updatedAt: Date.now() }), "utf8"); } catch { /* yazılamazsa bellekte sürer */ }
}

async function api(path: string, method: "GET" | "POST" = "GET"): Promise<Record<string, unknown> | null> {
  if (!key()) return null;
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const t = await r.json().catch(() => ({})); return { _status: r.status, error: (t as { error?: string }).error ?? "" }; }
    return (await r.json()) as Record<string, unknown>;
  } catch { return null; }
}

// RunPod GraphQL (terminate + taze deploy REST'te yok).
async function gql(query: string): Promise<Record<string, unknown> | null> {
  if (!key()) return null;
  try {
    const r = await fetch("https://api.runpod.io/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000),
    });
    return (await r.json()) as Record<string, unknown>;
  } catch { return null; }
}

type PodInfo = { status: string; host: string; sshPort: number };
export async function podStatus(): Promise<PodInfo | null> {
  const id = await getPodId();
  if (!id) return null;
  const j = await api(`/pods/${id}`);
  if (!j || j._status) return null;
  const pm = (j.portMappings ?? {}) as Record<string, number>;
  return { status: String(j.desiredStatus ?? ""), host: String(j.publicIp ?? ""), sshPort: Number(pm["22"]) || 0 };
}

// Kapasite/makine-kilidi hatası mı? (durdurulmuş pod indiği makineye kilitlidir;
// o makine dolunca restart hep başarısız — çözüm: taze deploy, boş makine bulunur.)
const isCapacityErr = (msg: string) => /not enough free GPUs|capacity|does not have the resources|no longer any instances/i.test(msg);

// Kilitli/dolu makineden kurtulmak için taze pod deploy et (boş makine bulur).
async function redeployPod(onLog?: (s: string) => void): Promise<string | null> {
  const old = await getPodId();
  onLog?.("Pod dolu makineye takıldı → boş makineye taşınıyor…");
  if (old) await gql(`mutation { podTerminate(input:{podId:"${old}"}) }`).catch(() => {});
  const q = `mutation { podFindAndDeployOnDemand(input: {
    cloudType: SECURE, gpuCount: 1, gpuTypeId: "${DEPLOY.gpu}", name: "qwen-a40",
    imageName: "${DEPLOY.image}", containerDiskInGb: ${DEPLOY.disk}, volumeInGb: 0, volumeMountPath: "/workspace",
    networkVolumeId: "${DEPLOY.volume}", dataCenterId: "${DEPLOY.dc}",
    ports: "22/tcp,8188/http", startSsh: true,
    env: [{ key: "PUBLIC_KEY", value: "${DEPLOY.pubkey}" }]
  }) { id } }`;
  const j = await gql(q);
  const data = (j?.data as { podFindAndDeployOnDemand?: { id?: string } } | undefined)?.podFindAndDeployOnDemand;
  if (!data?.id) return "Taze pod açılamadı (bölgede boş GPU yok). Birkaç dakika sonra tekrar dene.";
  await savePodId(data.id);
  onLog?.("Yeni pod açıldı, başlatılıyor…");
  return null;
}

// Başlatmayı dene; kapasite/makine-kilidi hatasında otomatik taze deploy. null = başarılı.
async function startPod(onLog?: (s: string) => void): Promise<string | null> {
  const id = await getPodId();
  if (id) {
    const j = await api(`/pods/${id}/start`, "POST");
    if (j && !j._status) return null; // başladı
    const msg = j ? String((j.error as string) || "") : "RunPod'a ulaşılamadı";
    if (j && !isCapacityErr(msg) && !(j._status === 500)) return `Pod başlatılamadı: ${msg || j._status}`;
    // kapasite / makine kilidi / 500 → taze deploy ile kurtar
  }
  return await redeployPod(onLog);
}
export async function stopPod(): Promise<void> { const id = await getPodId(); if (id) await api(`/pods/${id}/stop`, "POST"); }

// Son kullanım anı — boşta durdurma için. Diske de yazılır ki deploy
// (konteyner yenileme) sayacı sıfırlayıp nöbetçiyi öldüremesin.
type Act = { lastActivity: number; runningSince: number };
let lastActivity = Date.now();
let runningSince = 0; // pod'un kesintisiz RUNNING olduğu başlangıç (emniyet kemeri için)
let touched = false; // bu süreçte gerçek kullanım oldu mu (diskteki eski sayaç ezmesin)
let sweeper: ReturnType<typeof setInterval> | null = null;

async function writeAct(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(ACT_FILE), { recursive: true });
    await fs.writeFile(ACT_FILE, JSON.stringify({ lastActivity, runningSince } satisfies Act), "utf8");
  } catch { /* sayaç yazılamazsa nöbetçi bellekten sürer */ }
}

// Dakikalık kontrol: pod açıksa ve (boşta kaldı VEYA azami süreyi aştı) → durdur.
async function sweep(): Promise<void> {
  const s = await podStatus();
  if (!s || s.status !== "RUNNING") {
    if (runningSince) { runningSince = 0; writeAct().catch(() => {}); }
    return;
  }
  if (!runningSince) { runningSince = Date.now(); writeAct().catch(() => {}); }
  const idle = Date.now() - lastActivity >= IDLE_MS;
  const tooLong = Date.now() - runningSince >= MAX_MS;
  if (!idle && !tooLong) return;
  console.warn(`[pod] otomatik durdurma: ${idle ? "boşta" : ""}${idle && tooLong ? " + " : ""}${tooLong ? "azami süre aşıldı" : ""}`);
  await stopPod().catch(() => {});
  lastActivity = Date.now(); runningSince = 0;
  writeAct().catch(() => {});
}

// Nöbetçiyi kur. Sunucu AÇILIŞINDA da çağrılır (instrumentation) → deploy
// sonrası bile pod açık kalmışsa süre dolunca kapatılır.
export async function startPodSweeper(): Promise<void> {
  if (sweeper || !podAutomationReady()) return;
  sweeper = setInterval(() => { sweep().catch(() => {}); }, 60_000);
  if (typeof sweeper.unref === "function") sweeper.unref();
  // Önceki sürecin sayacını devral (bu süreçte henüz kullanım yoksa)
  try {
    const a = JSON.parse(await fs.readFile(ACT_FILE, "utf8")) as Partial<Act>;
    if (!touched && typeof a.lastActivity === "number" && a.lastActivity > 0 && a.lastActivity < lastActivity) lastActivity = a.lastActivity;
    if (typeof a.runningSince === "number" && a.runningSince > 0) runningSince = a.runningSince;
  } catch { /* ilk çalışma — dosya yok */ }
}

export function touchPod(): void {
  touched = true;
  lastActivity = Date.now();
  writeAct().catch(() => {});
  startPodSweeper().catch(() => {});
}

// Pod'u üretime hazır hale getir: gerekiyorsa başlat, SSH'ı bağla, start-all.sh çalıştır, ComfyUI'yi bekle.
// onLog ile ilerleme bildirilir. Hazır olunca döner; olmazsa Error fırlatır.
export async function ensurePodReady(onLog?: (s: string) => void): Promise<void> {
  touchPod();
  if (!podAutomationReady()) return; // otomasyon kapalı — mevcut köprüye güven
  const log = (s: string) => onLog?.(s);

  let st = await podStatus();

  // Pod yok (silinmiş/ID geçersiz) ya da RUNNING değil → başlat/kurtar.
  // startPod kapasite/makine-kilidi hatasında otomatik taze deploy eder (yeni ID kaydeder).
  if (!st || st.status !== "RUNNING") {
    log(st ? "Pod başlatılıyor…" : "Pod bulunamadı, yeni pod açılıyor…");
    const e = await startPod(log);
    if (e) throw new Error(e);
    // RUNNING + SSH portu gelene kadar bekle (~2-3 dk; taze deploy biraz daha uzun)
    for (let i = 0; i < 45; i++) {
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
