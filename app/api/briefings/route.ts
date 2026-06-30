import { loadBriefings } from "@/lib/loops/store";

export const runtime = "nodejs";

export async function GET() {
  const briefings = (await loadBriefings()).sort((a, b) => b.ts - a.ts);
  return Response.json({ briefings });
}
