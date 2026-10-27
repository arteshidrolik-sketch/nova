// Güvenlik ajanı ucu: POST {target, level} → sızma testini canlı akıtır ve rapor yazar.
// GET → kapsam + son raporlar. Pod'u (sansürsüz Qwen + güvenlik araçları) hazırlar.
import { runSecurityAgent } from "@/lib/security/agent";
import { getScope, setScope, type Scope } from "@/lib/security/scope";
import { ensureFromCfg, tunnelTarget } from "@/lib/studio/tunnel";
import { ensurePodReady, podAutomationReady, touchPod } from "@/lib/studio/pod";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 800;

const REPORTS = path.join(process.cwd(), "data", "security", "reports");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("report");
  if (file) {
    // tek rapor içeriği (yol kaçışı engelli)
    const safe = path.basename(file);
    try { return Response.json({ name: safe, content: await fs.readFile(path.join(REPORTS, safe), "utf8") }); }
    catch { return Response.json({ error: "rapor bulunamadı" }, { status: 404 }); }
  }
  const scope = await getScope();
  let reports: { name: string; ts: number }[] = [];
  try {
    const files = await fs.readdir(REPORTS);
    const stats = await Promise.all(files.filter((f) => f.endsWith(".md")).map(async (f) => ({ name: f, ts: (await fs.stat(path.join(REPORTS, f))).mtimeMs })));
    reports = stats.sort((a, b) => b.ts - a.ts).slice(0, 30);
  } catch { /* henüz rapor yok */ }
  return Response.json({ scope, reports });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { target?: string; level?: string; scope?: Scope };
  // Kapsam düzenleme
  if (b.scope) { await setScope(b.scope); return Response.json({ scope: await getScope() }); }

  const target = String(b.target || "").trim();
  const level = b.level === "saldiri" ? "saldiri" : "kesif";
  if (!target) return Response.json({ error: "hedef gerekli" }, { status: 400 });

  touchPod();
  if (podAutomationReady()) {
    try { await ensurePodReady(); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "pod hazırlanamadı" }, { status: 503 }); }
  }
  if (!tunnelTarget()) await ensureFromCfg();
  if (!tunnelTarget()) return Response.json({ error: "Pod bağlı değil. Önce Admin'de bağlan." }, { status: 409 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (s: string) => { try { controller.enqueue(encoder.encode(s)); touchPod(); } catch { /* kapandı */ } };
      try {
        await runSecurityAgent({ target, level, emit });
      } catch (e) {
        emit(`\n\n⚠️ ${e instanceof Error ? e.message : "ajan hatası"}`);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
