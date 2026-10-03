// Instagram'ın yayın sırasında görseli/videoyu çektiği uç. Basic-auth DIŞINDA
// (docker-compose'da ayrı Traefik router'ı); yalnız imzalı (sig) istekler geçer.
// Video için Range (parça) isteklerini destekler.
import { promises as fs } from "fs";
import path from "path";
import { mediaSig } from "@/lib/ig/instagram";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "workspace", "ig");
const TYPES: Record<string, string> = { jpg: "image/jpeg", mp4: "video/mp4" };

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const sig = new URL(req.url).searchParams.get("sig") || "";
  const m = file.match(/^[\w-]+\.(jpg|mp4)$/);
  if (!m || sig !== mediaSig(file)) {
    return new Response("Yok", { status: 404 });
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await fs.readFile(path.join(DIR, file)));
  } catch {
    return new Response("Yok", { status: 404 });
  }
  const type = TYPES[m[1]];
  const total = bytes.byteLength;
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
