import { loadCustomAgents, createCustomAgent } from "@/lib/agents/custom";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ agents: await loadCustomAgents() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body?.name?.trim() || !body?.systemPrompt?.trim()) {
    return Response.json({ error: "Ad ve sistem promptu gerekli." }, { status: 400 });
  }
  const agent = await createCustomAgent(body);
  return Response.json({ agent });
}
