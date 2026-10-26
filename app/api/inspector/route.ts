// Müfettiş paneli ucu: GET = skor tablosu + son verdiktler; POST = kuyruğu işle (pod uyandırır).
import { readVerdicts, scoreboard, readQueue } from "@/lib/inspector/store";
import { processQueue } from "@/lib/inspector/inspect";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET() {
  const verdicts = await readVerdicts();
  const recent = [...verdicts].sort((a, b) => b.ts - a.ts).slice(0, 40);
  const pending = (await readQueue()).length;
  return Response.json({ scoreboard: scoreboard(verdicts), recent, pending });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action === "run") {
    const r = await processQueue({ wake: true });
    return Response.json(r);
  }
  return Response.json({ error: "bilinmeyen işlem" }, { status: 400 });
}
