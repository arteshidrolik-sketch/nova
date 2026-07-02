import {
  addProject,
  getActiveId,
  listProjects,
  projectExists,
  setActive,
  setProjectConversation,
} from "@/lib/projects/store";
import {
  createConversation,
  updateConversation,
} from "@/lib/conversations/store";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const PROJECTS_DIR = process.env.NOVA_PROJECTS_DIR || "/srv/projects";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "proje"
  );
}

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
  const prompt = String(body?.prompt ?? "").trim();
  const newProject = Boolean(body?.newProject);

  if (!name) {
    return Response.json({ error: "name_required" }, { status: 400 });
  }

  // Yeni proje modu: sunucuda klasör oluştur + prompt'u kaydet + aktif yap
  if (newProject || (!p && prompt)) {
    let dir = path.join(PROJECTS_DIR, slugify(name));
    try {
      let i = 2;
      while (await projectExists(dir)) {
        dir = path.join(PROJECTS_DIR, `${slugify(name)}-${i++}`);
        if (i > 50) break;
      }
      await fs.mkdir(dir, { recursive: true });
      if (prompt) {
        await fs.writeFile(path.join(dir, "PROMPT.md"), prompt + "\n", "utf8");
      }
    } catch (e) {
      return Response.json(
        {
          error: "create_failed",
          message: e instanceof Error ? e.message : String(e),
        },
        { status: 500 },
      );
    }
    const project = await addProject({ name, path: dir, repoUrl });
    await setActive(project.id);
    // Projeye özel sohbet (proje adıyla)
    const conv = await createConversation();
    await updateConversation(conv.id, { title: name });
    await setProjectConversation(project.id, conv.id);
    return Response.json({ project: { ...project, conversationId: conv.id } });
  }

  // Mevcut klasör modu (eski davranış)
  if (!p) {
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
