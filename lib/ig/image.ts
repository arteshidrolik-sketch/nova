// Görsel üretimi (karakter referanslı) + hazırlama + balon.
// Sağlayıcı sırası: IG_IMAGE_PROVIDER (gemini|fal) → diğeri yedek.
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { imagePrompt } from "./persona";

const run = promisify(execFile);
const ASSETS = path.join(process.cwd(), "assets", "ig");
export const IG_DIR = path.join(process.cwd(), "workspace", "ig");
const PY = process.env.NOVA_PYTHON || (process.platform === "win32" ? "python" : "python3");

async function refB64(): Promise<string> {
  return (await fs.readFile(path.join(ASSETS, "karakter.jpg"))).toString("base64");
}

async function viaGemini(prompt: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY yok");
  const model = process.env.IG_GEMINI_MODEL || "gemini-2.5-flash-image";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: await refB64() } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "4:5" },
        },
      }),
    },
  );
  const j = (await res.json()) as {
    error?: { message?: string; code?: number };
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  if (!res.ok || j.error) throw new Error(`Gemini ${res.status}: ${j.error?.message || "hata"}`);
  const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!data) throw new Error("Gemini görsel döndürmedi (güvenlik filtresi olabilir)");
  return Buffer.from(data, "base64");
}

async function viaFal(prompt: string): Promise<Buffer> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY yok");
  const model = process.env.IG_FAL_MODEL || "fal-ai/nano-banana/edit";
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_urls: [`data:image/jpeg;base64,${await refB64()}`],
      num_images: 1,
      aspect_ratio: "4:5",
      output_format: "jpeg",
    }),
  });
  const j = (await res.json()) as { images?: { url?: string }[]; detail?: unknown };
  const url = j.images?.[0]?.url;
  if (!res.ok || !url) throw new Error(`fal ${res.status}: ${JSON.stringify(j.detail ?? j).slice(0, 200)}`);
  const img = await fetch(url);
  return Buffer.from(await img.arrayBuffer());
}

// Ham görsel üretir; ilk sağlayıcı hata verirse diğerini dener.
export async function generateRaw(sahne: string): Promise<Buffer> {
  const prompt = imagePrompt(sahne);
  const first = process.env.IG_IMAGE_PROVIDER === "fal" ? viaFal : viaGemini;
  const second = first === viaFal ? viaGemini : viaFal;
  try {
    return await first(prompt);
  } catch (e1) {
    try {
      return await second(prompt);
    } catch (e2) {
      throw new Error(`${(e1 as Error).message} | yedek: ${(e2 as Error).message}`);
    }
  }
}

async function py(args: string[]): Promise<void> {
  await run(PY, [path.join(ASSETS, "balon.py"), ...args], {
    timeout: 60_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
}

// Ham → kenar şeridi kırpılmış 1080x1350 JPEG (yol döner).
export async function prepare(id: string, raw: Buffer): Promise<string> {
  await fs.mkdir(IG_DIR, { recursive: true });
  const rawPath = path.join(IG_DIR, `${id}-ham.png`);
  const basePath = path.join(IG_DIR, `${id}-base.jpg`);
  await fs.writeFile(rawPath, raw);
  await py(["hazirla", rawPath, basePath]);
  await fs.unlink(rawPath).catch(() => {});
  return basePath;
}

// Balonlu son görsel; dosya adı döner (workspace/ig/ altında).
export async function addBubble(id: string, basePath: string, balon: string, headX: number, headY: number): Promise<string> {
  const name = `${id}.jpg`;
  await py(["balon", basePath, path.join(IG_DIR, name), balon, "--kafa", `${headX},${headY}`]);
  return name;
}
