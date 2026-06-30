import { deleteSkill, updateSkill } from "@/lib/skills/store";
import { isAgentKey, type AgentKey } from "@/lib/agents/meta";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (typeof body?.description === "string") patch.description = body.description;
  if (typeof body?.content === "string") patch.content = body.content;
  if (typeof body?.source === "string") patch.source = body.source;
  if (Array.isArray(body?.agentKeys)) {
    patch.agentKeys = body.agentKeys.filter(isAgentKey) as AgentKey[];
  }
  const skill = await updateSkill(id, patch);
  if (!skill) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ skill });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteSkill(id);
  return Response.json({ ok });
}
