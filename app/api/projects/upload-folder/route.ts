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

export const runtime = "nodejs";
export const maxDuration = 300;

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

// Bilgisayardan seçilen bir klasörün tüm dosyalarını (göreli yollarıyla) alır,
// sunucuda /srv/projects/<ad> altına yazar, proje + sohbet oluşturur.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "bad_form" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });

  let rels: string[] = [];
  try {
    rels = JSON.parse(String(form.get("paths") ?? "[]"));
  } catch {
    rels = [];
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof Blob);
  if (files.length === 0) {
    return Response.json({ error: "no_files" }, { status: 400 });
  }

  // Hedef klasör (çakışmadan)
  let dir = path.join(PROJECTS_DIR, slugify(name));
  let i = 2;
  while (await projectExists(dir)) {
    dir = path.join(PROJECTS_DIR, `${slugify(name)}-${i++}`);
    if (i > 50) break;
  }

  const root = path.resolve(dir);
  try {
    await fs.mkdir(dir, { recursive: true });
    for (let idx = 0; idx < files.length; idx++) {
      const rel = (rels[idx] || files[idx].name || `dosya-${idx}`).replace(
        /\\/g,
        "/",
      );
      const dest = path.resolve(dir, rel);
      // zip-slip / .. koruması: hedef proje kökünün dışına çıkmasın
      if (dest !== root && !dest.startsWith(root + path.sep)) continue;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(await files[idx].arrayBuffer()));
    }
  } catch (e) {
    return Response.json(
      {
        error: "write_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const project = await addProject({ name, path: dir });
  await setActive(project.id);
  const conv = await createConversation();
  await updateConversation(conv.id, { title: name });
  await setProjectConversation(project.id, conv.id);
  return Response.json({ project: { ...project, conversationId: conv.id } });
}
