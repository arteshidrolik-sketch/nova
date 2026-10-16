// Gerçekçi ofis "kamera" karesi: her proje için bir kez üretilir ve saklanır
// (data/office/<id>.png + .json). Proje ekibinin cinsiyet/rol dağılımına göre
// fotoğraf gerçekliğinde, tavan köşesinden bakan bir güvenlik kamerası açısı.
// Sağlayıcılar sırayla denenir (Gemini → OpenAI → fal); hangisinde kredi varsa o.
// Ardından Claude görseldeki 4 kişinin kutusunu bulur → arayüz durum/isim
// etiketlerini ve "takip kutularını" tam kişilerin üstüne yerleştirir.
import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import { teamCast, type TeamRole } from "@/lib/team/roles";

export const SEATS: TeamRole[] = ["research", "manager", "coder", "marketing"]; // soldan sağa
export type Box = { x: number; y: number; w: number; h: number }; // görsel yüzdesi (0-100)
export type Scene = { createdAt: number; provider: string; width: number; height: number; boxes: Partial<Record<TeamRole, Box>> };
type Fail = { at: number; error: string };

const DIR = path.join(process.cwd(), "data", "office");
const RETRY_MS = 20 * 60e3; // başarısız üretimden sonra bekleme (kredi yokken sürekli denemesin)
const pending = new Set<string>();
const fails = new Map<string, Fail>();

const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
export const imagePath = (id: string) => path.join(DIR, `${safe(id)}.png`);
const metaPath = (id: string) => path.join(DIR, `${safe(id)}.json`);

export async function getScene(id: string): Promise<Scene | null> {
  try { return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as Scene; } catch { return null; }
}

export function sceneStatus(id: string): { pending: boolean; fail: Fail | null } {
  return { pending: pending.has(id), fail: fails.get(id) ?? null };
}

function prompt(id: string): string {
  const cast = teamCast(id);
  const who = (r: TeamRole) => (cast[r].gender === "k" ? "woman" : "man");
  return (
    "Photorealistic wide establishing shot from a security camera mounted high on the BACK wall of a spacious, calm, minimalist office in Istanbul, " +
    "seen from far away: the camera is distant, people look SMALL in the frame (each person about one fifth of the image height), lots of open floor and empty space around them. " +
    "Clean Scandinavian design: white walls, light oak floor, a few simple white desks, one plant, large windows with soft daylight and a distant city view. " +
    "Uncluttered and airy — no shelves full of items, no papers, no clutter, nothing in the foreground, no objects close to the camera. " +
    "Exactly FOUR people, each sitting alone at their own small desk with a single monitor, the four desks spread in ONE row from left to right with wide gaps between them, " +
    "all four fully visible:\n" +
    `1 (far left): a Turkish ${who("research")} in their late 20s, research analyst;\n` +
    `2 (center-left): a Turkish ${who("manager")} in their 30s, team manager in a smart jacket;\n` +
    `3 (center-right): a Turkish ${who("coder")} in their late 20s, software developer;\n` +
    `4 (far right): a Turkish ${who("marketing")} in their late 20s, marketing specialist.\n` +
    "Real photograph, natural colors, soft light, high detail. No text, no logos, no watermark, no overlay, no fisheye."
  );
}

// ---- sağlayıcılar: başarıda PNG/JPEG baytları döner, yoksa hata fırlatır ----
async function viaGemini(p: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY yok");
  const model = process.env.NOVA_OFFICE_IMAGE_MODEL || "gemini-3.1-flash-image";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "21:9" } } }),
  }).then((x) => x.json());
  const part = (r.candidates?.[0]?.content?.parts || []).find((x: { inlineData?: { data: string } }) => x.inlineData);
  if (!part) throw new Error(`Gemini: ${r.error?.message?.slice(0, 120) || "görsel dönmedi"}`);
  return Buffer.from(part.inlineData.data, "base64");
}
async function viaOpenAI(p: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY yok");
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt: p, size: "1536x1024", quality: "medium", n: 1 }),
  }).then((x) => x.json());
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI: ${r.error?.message?.slice(0, 120) || "görsel dönmedi"}`);
  return Buffer.from(b64, "base64");
}
// fal: önce nano-banana (kişi sayısına sadık, fotogerçekçi), olmazsa flux
async function viaFal(p: string): Promise<Buffer> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY yok");
  const errs: string[] = [];
  for (const [model, body] of [
    ["fal-ai/nano-banana", { prompt: p, aspect_ratio: "21:9", num_images: 1, output_format: "jpeg" }],
    ["fal-ai/flux/dev", { prompt: p, image_size: { width: 1792, height: 768 }, num_images: 1 }],
  ] as const) {
    const r = await fetch(`https://fal.run/${model}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const url = j.images?.[0]?.url;
    if (url) return Buffer.from(await (await fetch(url)).arrayBuffer());
    errs.push(`${model}: ${String(j.detail || r.status).slice(0, 100)}`);
  }
  throw new Error(`fal: ${errs.join(" / ")}`);
}

function imageSize(buf: Buffer): { w: number; h: number; mime: string } {
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: "image/png" };
  // JPEG: SOF işaretçisini ara
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), mime: "image/jpeg" };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 1600, h: 686, mime: "image/jpeg" };
}

// Claude ile 4 kişinin kutusunu bul (soldan sağa)
async function locate(buf: Buffer, mime: string): Promise<Box[]> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: process.env.NOVA_OFFICE_VISION_MODEL || "claude-sonnet-5",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } },
        { type: "text", text: "Bu ofis fotoğrafındaki masada oturan insanları bul. Her kişi için baş+gövdesini (masa üstü dahil değil) saran kutuyu, görselin genişlik/yüksekliğine göre YÜZDE (0-100) olarak ver. Soldan sağa sırala. YALNIZ JSON döndür: {\"people\":[{\"x\":sol,\"y\":üst,\"w\":genişlik,\"h\":yükseklik}]}" },
      ],
    }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  const people = (m ? JSON.parse(m[0]).people : []) as Box[];
  return people
    .filter((b) => [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && v >= 0 && v <= 100))
    .sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
}

export async function generateScene(id: string): Promise<void> {
  if (pending.has(id)) return;
  const f = fails.get(id);
  if (f && Date.now() - f.at < RETRY_MS) return;
  pending.add(id);
  try {
    const p = prompt(id);
    let buf: Buffer | null = null, provider = "", boxes: Box[] = [], w = 0, h = 0;
    // kişi sayısı 4 çıkmazsa en fazla 3 deneme; en iyi sonuç saklanır
    for (let attempt = 0; attempt < 3; attempt++) {
      const errors: string[] = [];
      let cand: Buffer | null = null, prov = "";
      for (const [name, fn] of [["gemini", viaGemini], ["openai", viaOpenAI], ["fal", viaFal]] as const) {
        try { cand = await fn(p); prov = name; break; } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
      }
      if (!cand) { if (buf) break; throw new Error(errors.join(" · ")); }
      const sz = imageSize(cand);
      let found: Box[] = [];
      try { found = await locate(cand, sz.mime); } catch (e) { console.warn("[ofis] konum bulunamadı:", e instanceof Error ? e.message : e); }
      if (!buf || Math.abs(found.length - 4) < Math.abs(boxes.length - 4)) { buf = cand; provider = prov; boxes = found; w = sz.w; h = sz.h; }
      if (found.length === 4) break;
      console.warn(`[ofis] ${id.slice(0, 8)}: ${found.length} kişi bulundu, yeniden üretiliyor (${attempt + 1}/3)`);
    }
    if (!buf) throw new Error("görsel üretilemedi");
    // 4 kişi bulunamadıysa eşit aralıklı varsayılan kutular
    if (boxes.length !== 4) boxes = SEATS.map((_, i) => ({ x: 4 + i * 24.5, y: 30, w: 18, h: 50 }));
    const scene: Scene = { createdAt: Date.now(), provider, width: w, height: h, boxes: Object.fromEntries(SEATS.map((r, i) => [r, boxes[i]])) };
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(imagePath(id), buf);
    await fs.writeFile(metaPath(id), JSON.stringify(scene));
    fails.delete(id);
    console.log(`[ofis] ${id.slice(0, 8)}: kamera karesi üretildi (${provider}, ${w}x${h})`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    fails.set(id, { at: Date.now(), error });
    console.warn(`[ofis] ${id.slice(0, 8)}: üretilemedi — ${error.slice(0, 300)}`);
  } finally {
    pending.delete(id);
  }
}

export async function resetScene(id: string): Promise<void> {
  fails.delete(id);
  await fs.rm(imagePath(id), { force: true });
  await fs.rm(metaPath(id), { force: true });
  // eski canlı klipler de gider (yeni karede kişilerin yeri değişir)
  for (const st of ["idle", ...SEATS]) await fs.rm(path.join(DIR, `${safe(id)}-v-${st}.mp4`), { force: true });
}
