// Stüdyo bağlantısı:
// GET  → köprü/servis durumu (pod ulaşılabiliyor mu, modeller, ComfyUI)
// POST {host, port, comfyUrl?} → pod bilgisini kaydet + SSH köprüsünü (yeniden) kur
import { connect, writeCfg, readCfg, tunnelTarget, ollamaStatus, comfyUp } from "@/lib/studio/tunnel";

export const runtime = "nodejs";

export async function GET() {
  const cfg = await readCfg();
  const [o, c] = await Promise.all([ollamaStatus(), comfyUp()]);
  return Response.json({
    configured: !!cfg?.host,
    host: cfg?.host ?? "", port: cfg?.port ?? 0,
    comfyUrl: cfg?.comfyUrl ?? "",
    tunnel: tunnelTarget(),
    ollama: o.up, models: o.models,
    comfy: c,
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { host?: string; port?: number; comfyUrl?: string };
  const host = String(b.host ?? "").trim().replace(/^.*@/, "").replace(/\s.*$/, "");
  const port = Number(b.port) || 0;
  if (!host || !port) return Response.json({ error: "host ve port gerekli" }, { status: 400 });
  await writeCfg({ host, port, comfyUrl: (b.comfyUrl ?? "").trim() || undefined, updatedAt: Date.now() });
  try { await connect(host, port); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "köprü kurulamadı" }, { status: 502 }); }
  const [o, c] = await Promise.all([ollamaStatus(), comfyUp()]);
  return Response.json({ ok: true, tunnel: tunnelTarget(), ollama: o.up, models: o.models, comfy: c });
}
