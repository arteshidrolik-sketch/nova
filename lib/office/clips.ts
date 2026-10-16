// Ofis kamerasında canlı sahne: kare HİÇ parçalanmaz (parçalayınca masa/zemin
// kopuk görünüyordu). Bunun yerine sahnenin TAMAMI için birkaç kısa video üretilir
// (fal · Kling): "herkes boşta" (arkasına yaslanmış, kahve içiyor) ve her ajan için
// "o çalışıyor, diğerleri dinleniyor". Hepsi aynı kareden başladığı için aralarında
// geçiş dikişsizdir; arayüz o an kim çalışıyorsa onun klibini oynatır.
// Sahne görseli bir kez 2× büyütülür; video için 16:9 kesit kişilerin ortasına alınır.
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import { getScene, imagePath, SEATS, type Scene } from "./scene";
import { teamCast, type TeamRole } from "@/lib/team/roles";

const run = promisify(execFile);
const DIR = path.join(process.cwd(), "data", "office");
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
const metaPath = (id: string) => path.join(DIR, `${safe(id)}.json`);

export const STATES = ["idle", ...SEATS] as const; // idle | research | manager | coder | marketing
export type VidState = (typeof STATES)[number];
export const videoPath = (id: string, st: VidState) => path.join(DIR, `${safe(id)}-v-${st}.mp4`);

export type SceneVideo = { crop: { x: number; y: number; w: number; h: number }; states: Partial<Record<VidState, boolean>>; at: number };
export type SceneWithVideo = Scene & { upscaled?: boolean; video?: SceneVideo };

const VIDEO_MODEL = process.env.NOVA_OFFICE_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video";
const SPOT = ["far left", "center-left", "center-right", "far right"]; // SEATS sırası
const BASE =
  "Static locked-off security camera shot, the camera does not move or zoom at all. Furniture, desks, chairs, floor, plant and windows stay perfectly still and unchanged. " +
  "Subtle, natural, realistic human motion only. Same lighting and colors.";

function promptFor(id: string, st: VidState): string {
  const cast = teamCast(id);
  const who = (r: TeamRole) => (cast[r].gender === "k" ? "woman" : "man");
  if (st === "idle")
    return `${BASE} Quiet break time: all four people sit relaxed, leaning back in their chairs. The ${who("research")} at the ${SPOT[0]} desk slowly sips coffee from a mug; the others rest, glance around or stretch a little. Nobody types.`;
  const i = SEATS.indexOf(st);
  return `${BASE} The ${who(st)} at the ${SPOT[i]} desk leans forward close to the computer and types busily on the keyboard, focused on the monitor. The other three people sit relaxed and leaning back; one slowly sips coffee.`;
}

const busy = new Set<string>();

function falHeaders() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY yok");
  return { "Content-Type": "application/json", Authorization: `Key ${key}` };
}

// fal kuyruk API'si: gönder → durum yokla → sonucu al
async function falQueue(model: string, body: unknown): Promise<Record<string, unknown>> {
  const H = falHeaders();
  const s = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.json());
  if (!s.request_id) throw new Error(`${model}: ${JSON.stringify(s).slice(0, 160)}`);
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(s.status_url, { headers: H }).then((r) => r.json()).catch(() => ({}));
    if (st.status === "COMPLETED") return fetch(s.response_url, { headers: H }).then((r) => r.json());
    if (st.status === "FAILED" || st.error) throw new Error(`${model} başarısız: ${JSON.stringify(st).slice(0, 160)}`);
  }
  throw new Error(`${model}: zaman aşımı`);
}

// Sahne görselini 2× büyüt (bir kez) → net görüntü
export async function ensureUpscaled(id: string): Promise<SceneWithVideo | null> {
  const scene = (await getScene(id)) as SceneWithVideo | null;
  if (!scene || scene.upscaled) return scene;
  const src = await fs.readFile(imagePath(id));
  const r = await falQueue("fal-ai/esrgan", { image_url: `data:image/jpeg;base64,${src.toString("base64")}`, scale: 2, model: "RealESRGAN_x4plus" });
  const img = r.image as { url?: string } | undefined;
  if (!img?.url) throw new Error("büyütme sonucu yok");
  const big = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  const out = await sharp(big).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const meta = await sharp(out).metadata();
  await fs.writeFile(imagePath(id), out);
  const next: SceneWithVideo = { ...scene, upscaled: true, width: meta.width ?? scene.width * 2, height: meta.height ?? scene.height * 2, createdAt: Date.now() };
  await fs.writeFile(metaPath(id), JSON.stringify(next));
  return next;
}

// 16:9 kesit: tam yükseklik, kişilerin ortasına hizalı
function videoCrop(scene: Scene) {
  const W = scene.width, H = scene.height;
  const h = H, w = Math.min(W, Math.round((H * 16) / 9));
  const centers = SEATS.map((r) => scene.boxes[r]).filter(Boolean).map((b) => ((b!.x + b!.w / 2) / 100) * W);
  const cx = centers.length ? centers.reduce((a, b) => a + b, 0) / centers.length : W / 2;
  const left = Math.max(0, Math.min(W - w, Math.round(cx - w / 2)));
  return { left, top: 0, width: w, height: h, pct: { x: (left / W) * 100, y: 0, w: (w / W) * 100, h: 100 } };
}

export function videosBusy(id: string) { return busy.has(id); }

export async function generateVideos(id: string, only?: VidState[]): Promise<void> {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const scene = await ensureUpscaled(id);
    if (!scene) throw new Error("sahne yok");
    const c = videoCrop(scene);
    const frame = await sharp(await fs.readFile(imagePath(id)))
      .extract({ left: c.left, top: c.top, width: c.width, height: c.height }).resize(1920, 1080).jpeg({ quality: 92 }).toBuffer();
    const image_url = `data:image/jpeg;base64,${frame.toString("base64")}`;
    const states: Partial<Record<VidState, boolean>> = { ...(scene.video?.states ?? {}) };
    await Promise.all(STATES.filter((st) => !only || only.includes(st)).map(async (st) => {
      try {
        const r = await falQueue(VIDEO_MODEL, { image_url, prompt: promptFor(id, st), duration: "5", negative_prompt: "camera movement, zoom, pan, warping, morphing furniture, distortion, flicker, blur" });
        const url = (r.video as { url?: string } | undefined)?.url;
        if (!url) throw new Error(`video yok: ${JSON.stringify(r).slice(0, 120)}`);
        const tmp = path.join(DIR, `.${safe(id)}-${st}.raw.mp4`);
        await fs.writeFile(tmp, Buffer.from(await (await fetch(url)).arrayBuffer()));
        // ileri + geri = aynı karede başlayıp biten dikişsiz döngü; 720p, sessiz, hızlı başlama
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp,
          "-filter_complex", "[0:v]scale=1280:720,setsar=1,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]",
          "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          videoPath(id, st)], { timeout: 180000 });
        await fs.rm(tmp, { force: true });
        states[st] = true;
      } catch (e) {
        console.warn(`[ofis] ${id.slice(0, 8)} ${st} videosu üretilemedi:`, e instanceof Error ? e.message : e);
      }
    }));
    // hiçbiri üretilemediyse (ör. bakiye bitti) kayıt bırakma → sonra yeniden denenebilsin
    if (!Object.values(states).some(Boolean)) throw new Error("hiçbir video üretilemedi");
    const latest = ((await getScene(id)) as SceneWithVideo | null) ?? scene;
    await fs.writeFile(metaPath(id), JSON.stringify({ ...latest, video: { crop: c.pct, states, at: Date.now() } }));
    console.log(`[ofis] ${id.slice(0, 8)}: canlı sahne videoları hazır (${Object.keys(states).length}/5)`);
  } catch (e) {
    console.warn(`[ofis] ${id.slice(0, 8)}: video üretimi başarısız —`, e instanceof Error ? e.message : e);
  } finally {
    busy.delete(id);
  }
}
