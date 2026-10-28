// Stüdyo görsel üretimi: Nova sunucusu pod'daki ComfyUI'yi (SSH köprüsü üzerinden) çalıştırır,
// üretilen görseli döndürür. Tarayıcı pod'a HİÇ bağlanmaz → PC tüneli / WARP sorunu yok.
import { ensureFromCfg, execOnPod, tunnelTarget } from "@/lib/studio/tunnel";
import { ensurePodReady, podAutomationReady, touchPod } from "@/lib/studio/pod";
import { enhanceImagePrompt, DEFAULT_NEGATIVE } from "@/lib/studio/prompt";
import { createJob, updateJob, getJob } from "@/lib/studio/imagejobs";
import { inspectAnatomy, ensureAnatomyModel, type AnatomyVerdict } from "@/lib/studio/anatomy";

export const runtime = "nodejs";
export const maxDuration = 600;

const COMFY = "http://127.0.0.1:8188";

function workflow(prompt: string, negative: string, w: number, h: number, seed: number, steps = 20, cfg = 1.0) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen-image-2.1-UC-fp8.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: negative } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed, steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "nova" } },
  };
}

// İstemci yoklaması: GET ?job=<id> → işin durumu (hazırsa görseli içerir).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("job") || "";
  const j = id ? getJob(id) : null;
  if (!j) return Response.json({ status: "unknown" }, { status: 404 });
  return Response.json(j);
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { prompt?: string; negative?: string; width?: number; height?: number; seed?: number; enhance?: boolean; steps?: number; cfg?: number; anatomy?: boolean };
  const raw = String(b.prompt ?? "").trim();
  if (!raw) return Response.json({ error: "prompt gerekli" }, { status: 400 });
  const w = Math.min(2048, Math.max(512, Number(b.width) || 1024));
  const h = Math.min(2048, Math.max(512, Number(b.height) || 1024));
  const seed = Number.isFinite(b.seed) ? Number(b.seed) : Math.floor(Math.random() * 1e9);
  // Kullanıcı açıkça verdiyse onu kullan; yoksa karmaşıklığa göre ayarla (aşağıda).
  const userSteps = Number.isFinite(b.steps) ? Math.min(40, Math.max(8, Number(b.steps))) : null;
  const userCfg = Number.isFinite(b.cfg) ? Math.min(7, Math.max(1, Number(b.cfg))) : null;

  // İşi oluştur ve HEMEN jobId dön. Üretim arka planda sürer (uzun sürse de
  // proxy bağlantıyı kesemez — istemci GET ?job ile yoklar).
  const jobId = crypto.randomUUID();
  createJob(jobId);

  (async () => {
    try {
      touchPod();
      if (podAutomationReady()) {
        updateJob(jobId, { note: "pod hazırlanıyor" });
        await ensurePodReady((s) => updateJob(jobId, { note: s }));
      }
      if (!tunnelTarget()) await ensureFromCfg();
      if (!tunnelTarget()) { updateJob(jobId, { status: "error", error: "Pod bağlı değil. Önce Admin'de bağlan." }); return; }

      // Prompt ajanı (2 geçişli): Türkçe isteği detaylı İngilizce prompt'a çevirir,
      // melez anatomiyi açıkça yazar; gerçekten belirsizse kullanıcıya soru döner.
      let prompt = raw;
      let negative = String(b.negative ?? "").trim() || DEFAULT_NEGATIVE;
      let complex = false;
      if (b.enhance !== false) {
        updateJob(jobId, { note: "prompt ajanı çalışıyor…" });
        const e = await enhanceImagePrompt(raw);
        if (e?.clarify) { updateJob(jobId, { status: "error", error: `❓ ${e.clarify}`, note: "" }); return; }
        if (e?.prompt) { prompt = e.prompt; if (!b.negative && e.negative) negative = e.negative; complex = !!e.complex; }
      }
      // Karmaşık/melez konu → daha yüksek cfg + adım (adherence); basitte cfg=1 (hızlı).
      const steps = userSteps ?? (complex ? 30 : 20);
      const cfg = userCfg ?? (complex ? 3.5 : 1);

      // ComfyUI'da tek üretim: kuyruk + sonucu bekle + görseli çek. {buf} döner.
      const genOne = async (neg: string, sd: number): Promise<Buffer> => {
        const q = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow(prompt, neg, w, h, sd, steps, cfg) }), signal: AbortSignal.timeout(20000) });
        if (!q.ok) throw new Error(`ComfyUI kuyruk hatası (${q.status})`);
        const pid = ((await q.json()) as { prompt_id?: string }).prompt_id;
        if (!pid) throw new Error("prompt_id alınamadı");
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const h2 = await fetch(`${COMFY}/history/${pid}`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => ({}));
          const entry = (h2 as Record<string, { status?: { status_str?: string }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>)[pid];
          if (!entry) continue;
          const imgs = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
          if (imgs.length) {
            const im = imgs[0];
            const url = `${COMFY}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder)}&type=${encodeURIComponent(im.type)}`;
            const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
            const safe = im.filename.replace(/[^A-Za-z0-9._-]/g, "");
            if (safe) execOnPod(`rm -f /workspace/ComfyUI/output/${safe}`).catch(() => {});
            return buf;
          }
          if (entry.status?.status_str === "error") throw new Error("ComfyUI üretim hatası");
        }
        throw new Error("zaman aşımı (görsel gelmedi)");
      };

      // Anatomi denetim DÖNGÜSÜ: üret → denetçi görseli inceler → kusurluysa
      // negatifi güçlendir + yeni seed → yeniden üret. Düzelene / hak bitene kadar.
      const anatomy = b.anatomy === true;
      const maxTries = anatomy ? 4 : 1;
      let neg = negative, sd = seed, buf: Buffer | null = null, verdict: AnatomyVerdict | null = null;
      if (anatomy) { updateJob(jobId, { note: "anatomi denetçisi hazırlanıyor…" }); await ensureAnatomyModel((s) => updateJob(jobId, { note: s })); }

      for (let t = 1; t <= maxTries; t++) {
        updateJob(jobId, { status: "generating", note: anatomy ? `üretiliyor (deneme ${t}/${maxTries})` : (complex ? "üretiliyor (yüksek uyum modu)" : "üretiliyor"), usedPrompt: prompt });
        buf = await genOne(neg, sd);
        if (!anatomy) break;
        updateJob(jobId, { note: `anatomi kontrol ediliyor (${t}/${maxTries})…` });
        verdict = await inspectAnatomy(buf.toString("base64"));
        if (!verdict || verdict.ok) break; // denetçi yoksa ya da anatomi temizse bitir
        if (t < maxTries) { // kusurlu → negatifi güçlendir, yeni seed, tekrar
          if (verdict.negativeAdd) neg = `${verdict.negativeAdd}, ${neg}`;
          sd = Math.floor(Math.random() * 1e9);
          updateJob(jobId, { note: `anatomi kusurlu (${verdict.defects.slice(0, 2).join(", ") || "kusur"}) → yeniden üretiliyor` });
        }
      }
      if (!buf) { updateJob(jobId, { status: "error", error: "üretilemedi" }); return; }
      const doneNote = anatomy ? (verdict?.ok ? "anatomi onaylandı ✓" : verdict ? `anatomi tam düzelmedi: ${verdict.defects.slice(0, 2).join(", ")}` : "denetçi yanıt vermedi") : "";
      updateJob(jobId, { status: "done", image: `data:image/png;base64,${buf.toString("base64")}`, seed: sd, usedPrompt: prompt, note: doneNote });
    } catch (e) {
      updateJob(jobId, { status: "error", error: e instanceof Error ? e.message : "hata" });
    }
  })();

  return Response.json({ jobId });
}
