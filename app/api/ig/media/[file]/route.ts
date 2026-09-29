// Instagram'ın yayın sırasında görseli çektiği uç. Basic-auth DIŞINDA
// (docker-compose'da ayrı Traefik router'ı); yalnız imzalı (sig) istekler geçer.
import { promises as fs } from "fs";
import path from "path";
import { mediaSig } from "@/lib/ig/instagram";

export const runtime = "nodejs";

const DIR = path.join(process.cwd(), "workspace", "ig");

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const sig = new URL(req.url).searchParams.get("sig") || "";
  if (!/^[\w-]+\.jpg$/.test(file) || sig !== mediaSig(file)) {
    return new Response("Yok", { status: 404 });
  }
  try {
    const bytes = new Uint8Array(await fs.readFile(path.join(DIR, file)));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Yok", { status: 404 });
  }
}
