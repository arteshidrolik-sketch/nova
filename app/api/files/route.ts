// Workspace dosyaları: listeleme + indirme + silme.
// generate_document / write_file üretilen dosyaları <app>/workspace/ altına
// kaydeder. Bu uç, "Dosyalar" sekmesinin dosyaları görüp indirmesini sağlar.
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const WORKSPACE = path.join(process.cwd(), "workspace");

// workspace içinde kalan güvenli yol (path traversal engeli)
function resolveSafe(rel: string): string | null {
  const target = path.normalize(path.join(WORKSPACE, rel));
  if (target !== WORKSPACE && !target.startsWith(WORKSPACE + path.sep)) return null;
  return target;
}

const MIME: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

type FileItem = { name: string; rel: string; size: number; mtime: number };

async function walk(dir: string, baseRel = ""): Promise<FileItem[]> {
  let out: FileItem[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = baseRel ? `${baseRel}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(await walk(full, rel));
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(full);
        out.push({ name: e.name, rel, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* atla */
      }
    }
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");

  // İndirme (veya inline önizleme)
  if (name) {
    const target = resolveSafe(name);
    if (!target) return new Response("Geçersiz yol", { status: 400 });
    try {
      const buf = await fs.readFile(target);
      const ext = path.extname(target).toLowerCase();
      const disp = url.searchParams.get("inline") ? "inline" : "attachment";
      const base = path.basename(target);
      // ASCII-güvenli ad + RFC 5987 UTF-8 adı (Türkçe karakterli dosyalar için).
      const ascii = base.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      const bytes = new Uint8Array(buf);
      return new Response(bytes, {
        headers: {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Disposition": `${disp}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
            base,
          )}`,
          // Content-Length ekle → tünel/tarayıcı indirmeyi güvenle tamamlar
          // (chunked yerine net boyut).
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("Dosya bulunamadı", { status: 404 });
    }
  }

  // Listeleme (en yeni önce)
  const files = await walk(WORKSPACE);
  files.sort((a, b) => b.mtime - a.mtime);
  return Response.json({ files });
}

// Yükleme: workspace'e dosya koyar → "Dosyalar" sekmesinde görünür.
// Claude Code gibi dış araçlar bitmiş videoyu buraya gönderir.
//   POST /api/files?name=<ad.mp4>   gövde: ham bayt
// Güvenlik: uç zaten Traefik basic-auth arkasında. FILES_UPLOAD_TOKEN tanımlıysa
// ayrıca x-upload-token başlığı istenir (basic-auth kalkarsa ikinci kilit).
const MAX_UPLOAD = 300 * 1024 * 1024; // 300 MB

export async function POST(req: Request) {
  const beklenen = process.env.FILES_UPLOAD_TOKEN;
  if (beklenen && req.headers.get("x-upload-token") !== beklenen) {
    return new Response("Yetkisiz", { status: 401 });
  }

  const name = new URL(req.url).searchParams.get("name");
  if (!name) return new Response("Ad gerekli (?name=...)", { status: 400 });
  const target = resolveSafe(name);
  if (!target) return new Response("Geçersiz yol", { status: 400 });

  const uzunluk = Number(req.headers.get("content-length") || 0);
  if (uzunluk > MAX_UPLOAD) {
    return new Response(`Dosya çok büyük (en fazla ${MAX_UPLOAD} bayt)`, { status: 413 });
  }

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return new Response("Boş gövde", { status: 400 });
    if (buf.length > MAX_UPLOAD) {
      return new Response(`Dosya çok büyük (en fazla ${MAX_UPLOAD} bayt)`, { status: 413 });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buf);
    return Response.json({
      ok: true,
      name: path.relative(WORKSPACE, target).replace(/\\/g, "/"),
      size: buf.length,
    });
  } catch (e) {
    return new Response(
      `Yazılamadı: ${e instanceof Error ? e.message : "bilinmeyen"}`,
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return new Response("Ad gerekli", { status: 400 });
  const target = resolveSafe(name);
  if (!target) return new Response("Geçersiz yol", { status: 400 });
  try {
    await fs.unlink(target);
    return Response.json({ ok: true });
  } catch {
    return new Response("Silinemedi", { status: 404 });
  }
}
