// Stüdyo görsel üretimi: Nova sunucusu pod'daki ComfyUI'yi (SSH köprüsü üzerinden) çalıştırır,
// üretilen görseli döndürür. Tarayıcı pod'a HİÇ bağlanmaz → PC tüneli / WARP sorunu yok.
import { ensureFromCfg, execOnPod, tunnelTarget } from "@/lib/studio/tunnel";

export const runtime = "nodejs";
export const maxDuration = 300;

const COMFY = "http://127.0.0.1:8188";

function workflow(prompt: string, negative: string, w: number, h: number, seed: number) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen-image-2.1-UC-fp8.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: negative } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed, steps: 20, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "nova" } },
  };
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { prompt?: string; negative?: string; width?: number; height?: number; seed?: number };
  const prompt = String(b.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "prompt gerekli" }, { status: 400 });
  const w = Math.min(2048, Math.max(512, Number(b.width) || 1024));
  const h = Math.min(2048, Math.max(512, Number(b.height) || 1024));
  const seed = Number.isFinite(b.seed) ? Number(b.seed) : Math.floor(Math.random() * 1e9);

  if (!tunnelTarget()) await ensureFromCfg();
  if (!tunnelTarget()) return Response.json({ error: "Pod bağlı değil. Önce Stüdyo'da bağlan." }, { status: 409 });

  try {
    const q = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow(prompt, String(b.negative ?? ""), w, h, seed) }), signal: AbortSignal.timeout(15000) });
    if (!q.ok) return Response.json({ error: `ComfyUI kuyruk hatası (${q.status})` }, { status: 502 });
    const pid = ((await q.json()) as { prompt_id?: string }).prompt_id;
    if (!pid) return Response.json({ error: "prompt_id alınamadı" }, { status: 502 });

    // sonucu bekle (en fazla ~4 dk)
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const h2 = await fetch(`${COMFY}/history/${pid}`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => ({}));
      const entry = (h2 as Record<string, { status?: { status_str?: string }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>)[pid];
      if (!entry) continue;
      const imgs = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
      if (imgs.length) {
        const im = imgs[0];
        const url = `${COMFY}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder)}&type=${encodeURIComponent(im.type)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
        const buf = Buffer.from(await r.arrayBuffer());
        // Görsel tarayıcıya base64 olarak gönderildi; diskte birikmesin diye pod'daki dosyayı sil.
        const safe = im.filename.replace(/[^A-Za-z0-9._-]/g, "");
        if (safe) execOnPod(`rm -f /workspace/ComfyUI/output/${safe}`).catch(() => {});
        return Response.json({ image: `data:image/png;base64,${buf.toString("base64")}`, seed, filename: im.filename });
      }
      if (entry.status?.status_str === "error") return Response.json({ error: "ComfyUI üretim hatası" }, { status: 502 });
    }
    return Response.json({ error: "zaman aşımı (görsel 4 dk'da gelmedi)" }, { status: 504 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "hata" }, { status: 502 });
  }
}
