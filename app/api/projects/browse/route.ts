import { readdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// Sunucudaki klasörleri gezmek için (Gözat penceresi). Basic-auth arkasında.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("path") || "/srv/projects";
  const dir = path.resolve(raw);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const parent = path.dirname(dir);
    return Response.json({
      path: dir,
      parent: parent === dir ? null : parent,
      dirs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      path: dir,
      parent: path.dirname(dir) === dir ? null : path.dirname(dir),
      dirs: [],
      error: msg,
    });
  }
}
