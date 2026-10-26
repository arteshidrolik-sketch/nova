// Müfettiş mantığı: sert metrikleri (ölçülür) anında puanlar; ilgililik + sert
// verdikti yerel sansürsüz modelden alır (kuyruk, pod açıkken toplu işlenir).
// Nova'nın ekip ajanlarını OPERASYON açısından denetler — iş doğruluğu müdürde.
import { ensureFromCfg, ollamaStatus } from "@/lib/studio/tunnel";
import { ensurePodReady, podAutomationReady } from "@/lib/studio/pod";
import {
  type RunMetrics, type RunPackage, type Dims, type Verdict,
  enqueue, appendVerdict, readQueue, setQueue, updateVerdict,
} from "./store";

const INSPECTOR_MODEL = process.env.NOVA_INSPECTOR_MODEL || "huihui_ai/qwen2.5-coder-abliterate:32b";

// Ağırlıklar (toplam 100). teslim + hız + disiplin + verim = sert (ölçülür); ilgililik = LLM.
const W = { teslim: 25, hiz: 20, disiplin: 20, verim: 15, ilgililik: 20 };
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Sert metrik puanları (modelden bağımsız, rakamlardan).
function hardDims(m: RunMetrics): Omit<Dims, "ilgililik"> {
  return {
    hiz: m.sec <= 20 ? 100 : clamp((100 * (300 - m.sec)) / (300 - 20)), // 20sn→100, 300sn→0
    teslim: m.failed ? 0 : 100, // boş teslim = 0
    verim: m.output <= 2000 ? 100 : m.output >= 16000 ? 20 : clamp(100 - ((m.output - 2000) / 14000) * 80),
    disiplin: clamp(100 - m.errors * 25), // her araç hatası -25
  };
}
function combine(d: Dims): number {
  const base = d.teslim * W.teslim + d.hiz * W.hiz + d.disiplin * W.disiplin + d.verim * W.verim;
  if (d.ilgililik === null) return clamp(base / (W.teslim + W.hiz + W.disiplin + W.verim)); // LLM yoksa 80 üzerinden
  return clamp((base + d.ilgililik * W.ilgililik) / 100);
}

// Müdür bir uzman teslimi aldığında çağrılır (bloklamaz, fire-and-forget).
// Sert puanı hemen yazar; LLM yargısı için paketi kuyruğa atar.
export async function captureRun(p: Omit<RunPackage, "id"> & { id?: string }): Promise<void> {
  const id = p.id || `${p.ts}-${p.role}-${Math.random().toString(36).slice(2, 7)}`;
  const pkg: RunPackage = { ...p, id };
  const hd = hardDims(pkg.metrics);
  const dims: Dims = { ...hd, ilgililik: null };
  const v: Verdict = {
    id, ts: pkg.ts, projectId: pkg.projectId, role: pkg.role, person: pkg.person,
    tier: pkg.tier, model: pkg.model, metrics: pkg.metrics, task: pkg.task.split("\n")[0].slice(0, 120),
    dims, total: combine(dims), judged: false,
  };
  await appendVerdict(v);
  await enqueue(pkg); // ilgililik + sert verdikt için (pod açıkken işlenir)
}

// Yerel sansürsüz modele tek seferlik sor (akışsız). Köprü hazır olmalı.
async function askInspector(pkg: RunPackage): Promise<{ ilgililik: number; verdikt: string } | null> {
  const sys =
    "Sen Nova'nın MÜFETTİŞİSİN: ters, kaba, acımasız ama ADİL bir performans denetçisi. " +
    "İŞİN DOĞRULUĞUNU denetlemezsin (onu müdür yapar) — yalnız ajanın göreve CEVAP VERİP VERMEDİĞİNİ denetlersin: " +
    "teslim göreve mi odaklı yoksa alakasız/gevşek/laf kalabalığı mı? " +
    "Sadece ilgililik+odaklanmayı 0-100 puanla (100=tam göreve odaklı ve öz, 0=alakasız/boş/saçma). " +
    "Verdiktin KISA (en fazla 2 cümle), sert ve dobra olsun; küfür serbest ama bilgi ver, sadece hakaret etme. " +
    'YALNIZCA şu JSON formatında yanıt ver, başka hiçbir şey yazma: {"ilgililik": <0-100>, "verdikt": "<kısa sert yorum>"}';
  const user =
    `GÖREV:\n${pkg.task.slice(0, 2500)}\n\nKABUL KRİTERLERİ:\n${(pkg.criteria || "(yok)").slice(0, 800)}\n\n` +
    `AJANIN TESLİMİ:\n${pkg.delivery.slice(0, 5000)}\n\n` +
    `ÖLÇÜLEN: süre ${pkg.metrics.sec}sn, çıktı tokeni ${pkg.metrics.output}, araç hatası ${pkg.metrics.errors}, ` +
    `üretilen dosya ${pkg.metrics.artifacts}${pkg.metrics.failed ? ", TESLİM BOŞ" : ""}.`;
  try {
    const r = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: INSPECTOR_MODEL, stream: false, options: { temperature: 0.3 }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(150000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { message?: { content?: string } };
    const txt = String(j?.message?.content || "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { ilgililik?: unknown; verdikt?: unknown };
    const ilgililik = clamp(Number(parsed.ilgililik));
    const verdikt = String(parsed.verdikt || "").slice(0, 600);
    if (!verdikt) return null;
    return { ilgililik, verdikt };
  } catch { return null; }
}

// Bekleyen kuyruğu işle (LLM yargısı). pod kapalıysa: wake=true ise uyandırır, değilse atlar.
export async function processQueue(opts: { wake?: boolean; max?: number } = {}): Promise<{ processed: number; pending: number; reason?: string }> {
  const queue = await readQueue();
  if (!queue.length) return { processed: 0, pending: 0 };

  await ensureFromCfg();
  let up = (await ollamaStatus()).up;
  if (!up) {
    if (opts.wake && podAutomationReady()) {
      try { await ensurePodReady(); } catch (e) { return { processed: 0, pending: queue.length, reason: e instanceof Error ? e.message : "pod uyanmadı" }; }
      up = (await ollamaStatus()).up;
    }
    if (!up) return { processed: 0, pending: queue.length, reason: "pod kapalı (Müfettişi çalıştır ile uyandır)" };
  }

  const max = opts.max ?? 20; // bir partide en fazla — süreyi sınırla
  const batch = queue.slice(0, max);
  let processed = 0;
  const done = new Set<string>();
  for (const pkg of batch) {
    const res = await askInspector(pkg);
    if (!res) continue; // başarısızsa kuyrukta kalsın, sonra tekrar denenir
    const hd = hardDims(pkg.metrics);
    const dims: Dims = { ...hd, ilgililik: res.ilgililik };
    await updateVerdict(pkg.id, { dims, total: combine(dims), judged: true, verdikt: res.verdikt });
    done.add(pkg.id);
    processed++;
  }
  if (done.size) await setQueue(queue.filter((p) => !done.has(p.id)));
  return { processed, pending: queue.length - done.size };
}
