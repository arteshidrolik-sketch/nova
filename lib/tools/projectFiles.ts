// Aktif proje üzerinde SALT-OKUMA dosya araçları (list/read/search).
// Yazma araçları actions.ts içinde (GO-onaylı).
import { promises as fs } from "fs";
import path from "path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  ".next",
  "Pods",
  "DerivedData",
  ".build",
  "vendor",
  "Carthage",
  ".idea",
  ".gradle",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".mp4", ".mov", ".mp3", ".wav", ".ttf", ".otf", ".woff", ".woff2",
  ".xcassets", ".car", ".a", ".o", ".class", ".jar", ".ipa", ".apk",
]);

// Yolu proje köküne hapseder
export function resolveIn(root: string, rel: string): string {
  const cleaned = (rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.normalize(path.join(root, cleaned));
  const base = path.normalize(root);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Geçersiz yol (proje dışına çıkılamaz).");
  }
  return target;
}

async function walk(
  root: string,
  dir: string,
  depth: number,
  out: string[],
  maxEntries = 400,
): Promise<void> {
  if (out.length >= maxEntries || depth < 0) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= maxEntries) return;
    if (e.name.startsWith(".") && e.name !== ".env.example") {
      if (IGNORE_DIRS.has(e.name)) continue;
    }
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      out.push(path.relative(root, full).replace(/\\/g, "/") + "/");
      await walk(root, full, depth - 1, out, maxEntries);
    } else {
      const full = path.join(dir, e.name);
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
}

async function listFiles(
  root: string,
  dir = ".",
  depth = 2,
): Promise<string> {
  const start = resolveIn(root, dir);
  const out: string[] = [];
  await walk(root, start, Math.min(Math.max(depth, 0), 4), out);
  return out.length ? out.slice(0, 400).join("\n") : "(boş)";
}

async function readFile(root: string, rel: string): Promise<string> {
  const target = resolveIn(root, rel);
  const buf = await fs.readFile(target, "utf8").catch(() => null);
  if (buf === null) return `Dosya okunamadı: ${rel}`;
  const max = 60_000;
  return buf.length > max
    ? buf.slice(0, max) + `\n… (kesildi, ${buf.length} karakter)`
    : buf;
}

async function searchFiles(
  root: string,
  query: string,
  files: string[],
): Promise<string> {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const rel of files) {
    if (hits.length >= 60) break;
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    const target = resolveIn(root, rel);
    let content: string;
    try {
      const st = await fs.stat(target);
      if (!st.isFile() || st.size > 1_000_000) continue;
      content = await fs.readFile(target, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        if (hits.length >= 60) break;
      }
    }
  }
  return hits.length ? hits.join("\n") : `"${query}" için eşleşme yok.`;
}

export const READ_TOOLS = [
  {
    name: "list_files",
    description:
      "Aktif projedeki dosya/klasörleri listeler. Önce yapıyı görmek için kullan.",
    input_schema: {
      type: "object" as const,
      properties: {
        dir: { type: "string", description: "Alt klasör (varsayılan kök)" },
        depth: { type: "integer", description: "Derinlik (varsayılan 2)" },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Aktif projedeki bir dosyanın içeriğini okur.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Köke göre dosya yolu" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "Aktif projede metin/kod arar (büyük-küçük harf duyarsız). Bir şeyin nerede olduğunu bulmak için kullan.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Aranacak metin" },
      },
      required: ["query"],
    },
  },
];

export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

export async function runReadTool(
  name: string,
  input: Record<string, unknown>,
  root: string,
): Promise<string> {
  try {
    if (name === "list_files") {
      return await listFiles(
        root,
        typeof input.dir === "string" ? input.dir : ".",
        typeof input.depth === "number" ? input.depth : 2,
      );
    }
    if (name === "read_file") {
      return await readFile(root, String(input.path ?? ""));
    }
    if (name === "search_files") {
      const all: string[] = [];
      await walk(root, root, 4, all, 2000);
      const files = all.filter((f) => !f.endsWith("/"));
      return await searchFiles(root, String(input.query ?? ""), files);
    }
    return "Bilinmeyen okuma aracı.";
  } catch (e) {
    return `Hata: ${e instanceof Error ? e.message : "bilinmeyen"}`;
  }
}
