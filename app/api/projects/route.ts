import {
  addProject,
  getActiveId,
  listProjects,
  projectExists,
} from "@/lib/projects/store";

export const runtime = "nodejs";

export async function GET() {
  const [projects, activeId] = await Promise.all([
    listProjects(),
    getActiveId(),
  ]);
  return Response.json({ projects, activeId });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const p = String(body?.path ?? "").trim();
  const repoUrl = body?.repoUrl ? String(body.repoUrl) : undefined;

  if (!name || !p) {
    return Response.json({ error: "name_path_required" }, { status: 400 });
  }
  if (!(await projectExists(p))) {
    return Response.json(
      { error: "path_not_found", message: "Klasör bulunamadı: " + p },
      { status: 400 },
    );
  }
  const project = await addProject({ name, path: p, repoUrl });
  return Response.json({ project });
}
