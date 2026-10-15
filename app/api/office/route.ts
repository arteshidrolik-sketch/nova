// Ofis kamera karesi:
// GET  ?scope=<proje>          → {status:"ready", scene} | {status:"pending"} | {status:"none", error}
//                                 (yoksa arka planda üretimi başlatır)
// GET  ?scope=<proje>&img=1    → görselin kendisi
// POST ?scope=<proje>          → yeniden üret
import { promises as fs } from "fs";
import { generateScene, getScene, imagePath, resetScene, sceneStatus } from "@/lib/office/scene";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("scope");
  if (!id) return Response.json({ error: "scope gerekli" }, { status: 400 });
  if (sp.get("img")) {
    try {
      const buf = await fs.readFile(imagePath(id));
      const png = buf[0] === 0x89;
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": png ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=86400" } });
    } catch { return new Response("yok", { status: 404 }); }
  }
  const scene = await getScene(id);
  if (scene) return Response.json({ status: "ready", scene });
  const st = sceneStatus(id);
  if (!st.pending && !(st.fail && Date.now() - st.fail.at < 20 * 60e3)) {
    generateScene(id).catch(() => {});
    return Response.json({ status: "pending" });
  }
  return st.pending ? Response.json({ status: "pending" }) : Response.json({ status: "none", error: st.fail?.error ?? "" });
}

export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("scope");
  if (!id) return Response.json({ error: "scope gerekli" }, { status: 400 });
  await resetScene(id);
  generateScene(id).catch(() => {});
  return Response.json({ status: "pending" });
}
