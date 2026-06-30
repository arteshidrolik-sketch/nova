import { createSkill, loadSkills } from "@/lib/skills/store";
import { isAgentKey, type AgentKey } from "@/lib/agents/meta";

export const runtime = "nodejs";

export async function GET() {
  const skills = await loadSkills();
  return Response.json({ skills });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const content = String(body?.content ?? "").trim();
  const agentKeys = (Array.isArray(body?.agentKeys) ? body.agentKeys : []).filter(
    isAgentKey,
  ) as AgentKey[];

  if (!name || !content || agentKeys.length === 0) {
    return Response.json(
      { error: "name_content_agents_required" },
      { status: 400 },
    );
  }
  const skill = await createSkill({
    name,
    description: String(body?.description ?? ""),
    content,
    agentKeys,
    source: body?.source ? String(body.source) : undefined,
  });
  return Response.json({ skill });
}
