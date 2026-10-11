import { createSkill, loadSkills } from "@/lib/skills/store";
import { isAgentKey, type AgentKey } from "@/lib/agents/meta";
import { isTeamRole } from "@/lib/team/roles";
import { ensureTeamSkills } from "@/lib/team/skills";

export const runtime = "nodejs";

export async function GET() {
  await ensureTeamSkills(); // ekip ajanlarının hazır becerileri (ilk seferde yüklenir)
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

  const teamRoles = (Array.isArray(body?.teamRoles) ? body.teamRoles : []).filter(isTeamRole) as string[];
  if (!name || !content || (agentKeys.length === 0 && teamRoles.length === 0)) {
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
    teamRoles,
    source: body?.source ? String(body.source) : undefined,
  });
  return Response.json({ skill });
}
