// Ofis kamera karesi:
// GET  ?scope=<proje>          → {status:"ready", scene} | {status:"pending"} | {status:"none", error}
//                                 (yoksa arka planda üretimi başlatır)
// GET  ?scope=<proje>&img=1    → görselin kendisi
// GET  ?scope=<proje>&clip=<idle|research|manager|coder|marketing> → canlı sahne videosu (mp4)
// POST ?scope=<proje>          → yeniden üret
// POST ?scope=<proje>&clips=1  → canlı sahne videolarını üret (görsel 2× büyütülür); clips=idle,coder → yalnız onlar
import { promises as fs } from "fs";
import { generateScene, getScene, imagePath, resetScene, sceneStatus } from "@/lib/office/scene";
import { generateVideos, STATES, videoPath, videosBusy, type VidState } from "@/lib/office/clips";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("scope");
  if (!id) return Response.json({ error: "scope gerekli" }, { status: 400 });
  const clip = sp.get("clip");
  if (clip) {
    if (!(STATES as readonly string[]).includes(clip)) return new Response("geçersiz", { status: 400 });
    try {
      const buf = await fs.readFile(videoPath(id, clip as VidState));
      const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = Number(range[1] || 0), end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
        return new Response(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "private, max-age=86400" } });
      }
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" } });
    } catch { return new Response("yok", { status: 404 }); }
  }
  if (sp.get("img")) {
    try {
      const buf = await fs.readFile(imagePath(id));
      const png = buf[0] === 0x89;
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": png ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=86400" } });
    } catch { return new Response("yok", { status: 404 }); }
  }
  const scene = await getScene(id);
  if (scene) return Response.json({ status: "ready", scene, clipsBusy: videosBusy(id) });
  const st = sceneStatus(id);
  if (!st.pending && !(st.fail && Date.now() - st.fail.at < 20 * 60e3)) {
    generateScene(id).catch(() => {});
    return Response.json({ status: "pending" });
  }
  return st.pending ? Response.json({ status: "pending" }) : Response.json({ status: "none", error: st.fail?.error ?? "" });
}

export async function POST(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("scope");
  if (!id) return Response.json({ error: "scope gerekli" }, { status: 400 });
  if (sp.get("clips")) {
    if (!(await getScene(id))) return Response.json({ error: "önce kamera karesi gerekli" }, { status: 409 });
    const only = sp.get("clips") === "1" ? undefined : (String(sp.get("clips")).split(",").filter((x) => (STATES as readonly string[]).includes(x)) as VidState[]);
    generateVideos(id, only).catch(() => {});
    return Response.json({ status: "clips-pending" });
  }
  await resetScene(id);
  generateScene(id).catch(() => {});
  return Response.json({ status: "pending" });
}
