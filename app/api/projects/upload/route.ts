import {
  addProject,
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
import AdmZip from "adm-zip";

export const runtime = "nodejs";
export const maxDuration = 120;

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

// ZIP olarak kaydedilmiş (başka platformda geliştirilmiş) bir uygulamayı yükler,
// sunucuda açar, proje olarak kaydeder + projeye özel sohbet oluşturur.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "bad_form" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const file = form.get("file");
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });
  if (!(file instanceof Blob)) {
    return Response.json({ error: "file_required" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Hedef klasör (çakışmadan)
  let dir = path.join(PROJECTS_DIR, slugify(name));
  let i = 2;
  while (await projectExists(dir)) {
    dir = path.join(PROJECTS_DIR, `${slugify(name)}-${i++}`);
    if (i > 50) break;
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    const zip = new AdmZip(buf);
    zip.extractAllTo(dir, true);
  } catch (e) {
    return Response.json(
      {
        error: "extract_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // Tek bir kök klasör varsa onu proje kökü yap (çift iç içe klasörü önle)
  let projectPath = dir;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const visible = entries.filter(
      (e) => !e.name.startsWith("__MACOSX") && !e.name.startsWith("."),
    );
    if (visible.length === 1 && visible[0].isDirectory()) {
      projectPath = path.join(dir, visible[0].name);
    }
  } catch {
    /* yoksay */
  }

  const project = await addProject({ name, path: projectPath });
  await setActive(project.id);
  const conv = await createConversation();
  await updateConversation(conv.id, { title: name });
  await setProjectConversation(project.id, conv.id);
  return Response.json({ project: { ...project, conversationId: conv.id } });
}
