// Müfettiş paneli ucu: GET = skor tablosu + son verdiktler; POST = kuyruğu işle (pod uyandırır).
import { readVerdicts, scoreboard, readQueue, readMeetings } from "@/lib/inspector/store";
import { processQueue } from "@/lib/inspector/inspect";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(req: Request) {
  // ?scope=<projectId> → yalnız o projenin verdiktleri (sohbet sağ paneli için)
  const scope = new URL(req.url).searchParams.get("scope") || "";
  const all = await readVerdicts();
  const verdicts = scope ? all.filter((v) => v.projectId === scope) : all;
  const recent = [...verdicts].sort((a, b) => b.ts - a.ts).slice(0, 40);
  const queue = await readQueue();
  const pending = (scope ? queue.filter((p) => p.projectId === scope) : queue).length;
  const meetings = (await readMeetings(scope || undefined, 10)).reverse(); // en yeni önde
  return Response.json({ scoreboard: scoreboard(verdicts), recent, pending, meetings });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action === "run") {
    const r = await processQueue({ wake: true });
    return Response.json(r);
  }
  return Response.json({ error: "bilinmeyen işlem" }, { status: 400 });
}
