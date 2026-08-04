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
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Disposition": `${disp}; filename="${encodeURIComponent(
            path.basename(target),
          )}"`,
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
