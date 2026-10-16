// Ofis kamerasında canlı ajanlar: her kişinin bölgesi kesilip fal'daki resimden-
// video modeliyle (Wan 2.2) iki kısa klip üretilir — "boşta" (arkasına yaslanmış,
// kahvesini yudumluyor) ve "çalışıyor" (bilgisayara eğilmiş, klavyede yazıyor).
// Klipler ileri-geri birleştirilip dikişsiz döngüye çevrilir; arayüz kişinin
// durumuna göre ikisi arasında yumuşak geçiş yapar. Ayrıca sahne görseli bir kez
// 2× büyütülür (net görüntü).
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import { getScene, imagePath, SEATS, type Scene } from "./scene";
import type { TeamRole } from "@/lib/team/roles";

const run = promisify(execFile);
const DIR = path.join(process.cwd(), "data", "office");
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
const metaPath = (id: string) => path.join(DIR, `${safe(id)}.json`);
export const clipPath = (id: string, role: TeamRole, state: "idle" | "work") => path.join(DIR, `${safe(id)}-${role}-${state}.mp4`);

export type ClipInfo = { rect: { x: number; y: number; w: number; h: number }; idle?: boolean; work?: boolean };
export type SceneWithClips = Scene & { upscaled?: boolean; clips?: Partial<Record<TeamRole, ClipInfo>>; clipsAt?: number };

const VIDEO_MODEL = process.env.NOVA_OFFICE_VIDEO_MODEL || "fal-ai/wan/v2.2-5b/image-to-video";
const PROMPTS = {
  idle: "Static security camera, the camera does not move at all. The person sits leaning back relaxed in the office chair, slowly sips coffee from a mug, lowers it and calmly looks around. Subtle natural motion, realistic, same lighting and colors.",
  work: "Static security camera, the camera does not move at all. The person leans forward close to the computer and types quickly on the keyboard while looking at the monitor, focused and busy. Subtle natural motion, realistic, same lighting and colors.",
};
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
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(s.status_url, { headers: H }).then((r) => r.json()).catch(() => ({}));
    if (st.status === "COMPLETED") return fetch(s.response_url, { headers: H }).then((r) => r.json());
    if (st.status === "FAILED" || st.error) throw new Error(`${model} başarısız: ${JSON.stringify(st).slice(0, 160)}`);
  }
  throw new Error(`${model}: zaman aşımı`);
}

async function saveMeta(id: string, scene: SceneWithClips) {
  await fs.writeFile(metaPath(id), JSON.stringify(scene));
}

// Sahne görselini 2× büyüt (bir kez) → net görüntü
export async function ensureUpscaled(id: string): Promise<SceneWithClips | null> {
  const scene = (await getScene(id)) as SceneWithClips | null;
  if (!scene || scene.upscaled) return scene;
  const src = await fs.readFile(imagePath(id));
  const r = await falQueue("fal-ai/esrgan", { image_url: `data:image/jpeg;base64,${src.toString("base64")}`, scale: 2, model: "RealESRGAN_x4plus" });
  const img = r.image as { url?: string } | undefined;
  if (!img?.url) throw new Error("büyütme sonucu yok");
  const big = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  const out = await sharp(big).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const meta = await sharp(out).metadata();
  await fs.writeFile(imagePath(id), out);
  const next: SceneWithClips = { ...scene, upscaled: true, width: meta.width ?? scene.width * 2, height: meta.height ?? scene.height * 2, createdAt: Date.now() };
  await saveMeta(id, next);
  return next;
}

// Kişi + masası: kişi kutusunun çevresinde kare bölge (görsel sınırlarına kırpılır)
function cropRect(scene: Scene, role: TeamRole) {
  const b = scene.boxes[role];
  if (!b) return null;
  const W = scene.width, H = scene.height;
  const side = Math.round(Math.min(H, Math.max((W * b.w * 3.2) / 100, (H * b.h * 1.9) / 100)) / 2) * 2;
  let left = Math.round((W * (b.x + b.w / 2)) / 100 - side / 2);
  let top = Math.round((H * (b.y - b.h * 0.35)) / 100);
  left = Math.max(0, Math.min(W - side, left));
  top = Math.max(0, Math.min(H - side, top));
  return { left, top, side, pct: { x: (left / W) * 100, y: (top / H) * 100, w: (side / W) * 100, h: (side / H) * 100 } };
}

async function makeClip(id: string, role: TeamRole, state: "idle" | "work", cropJpeg: Buffer, side: number) {
  const r = await falQueue(VIDEO_MODEL, { image_url: `data:image/jpeg;base64,${cropJpeg.toString("base64")}`, prompt: PROMPTS[state], num_frames: 81, resolution: "580p" });
  const url = (r.video as { url?: string } | undefined)?.url;
  if (!url) throw new Error(`video yok: ${JSON.stringify(r).slice(0, 120)}`);
  const tmp = path.join(DIR, `.${safe(id)}-${role}-${state}.raw.mp4`);
  await fs.writeFile(tmp, Buffer.from(await (await fetch(url)).arrayBuffer()));
  const size = Math.min(side, 512);
  // ileri + geri = dikişsiz döngü; kesit boyutuna ölçekle, sessiz, web için hızlı başlama
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp,
    "-filter_complex", `[0:v]scale=${size}:${size},setsar=1,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]`,
    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    clipPath(id, role, state)], { timeout: 120000 });
  await fs.rm(tmp, { force: true });
}

export function clipsBusy(id: string) { return busy.has(id); }

export async function generateClips(id: string, roles: TeamRole[] = SEATS): Promise<void> {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const scene = await ensureUpscaled(id);
    if (!scene) throw new Error("sahne yok");
    const src = await fs.readFile(imagePath(id));
    const clips: Partial<Record<TeamRole, ClipInfo>> = { ...(scene.clips ?? {}) };
    await Promise.all(roles.map(async (role) => {
      const c = cropRect(scene, role);
      if (!c) return;
      const crop = await sharp(src).extract({ left: c.left, top: c.top, width: c.side, height: c.side }).jpeg({ quality: 92 }).toBuffer();
      const info: ClipInfo = { rect: c.pct };
      for (const state of ["idle", "work"] as const) {
        try { await makeClip(id, role, state, crop, c.side); info[state] = true; }
        catch (e) { console.warn(`[ofis] ${id.slice(0, 8)} ${role}/${state} klip üretilemedi:`, e instanceof Error ? e.message : e); }
      }
      clips[role] = info;
    }));
    const latest = ((await getScene(id)) as SceneWithClips | null) ?? scene;
    await saveMeta(id, { ...latest, clips, clipsAt: Date.now() });
    console.log(`[ofis] ${id.slice(0, 8)}: canlı klipler hazır (${Object.keys(clips).length} kişi)`);
  } catch (e) {
    console.warn(`[ofis] ${id.slice(0, 8)}: klip üretimi başarısız —`, e instanceof Error ? e.message : e);
  } finally {
    busy.delete(id);
  }
}
