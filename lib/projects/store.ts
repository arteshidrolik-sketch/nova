// Proje kaydı — yerel klasöre bağlı projeler. Aktif proje ajanların çalışacağı yer.
import { promises as fs } from "fs";
import path from "path";

export type Project = {
  id: string;
  name: string;
  path: string; // mutlak yerel yol
  repoUrl?: string;
  conversationId?: string; // projeye ait sohbet
  self?: boolean; // Nova'nın kendi kaynak kodu (beyin)
  createdAt: number;
};

type Data = { activeId: string | null; projects: Project[] };

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "projects.json");

async function load(): Promise<Data> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const d = JSON.parse(raw);
    return {
      activeId: d?.activeId ?? null,
      projects: Array.isArray(d?.projects) ? d.projects : [],
    };
  } catch {
    return { activeId: null, projects: [] };
  }
}

async function persist(d: Data): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(d, null, 2), "utf8");
}

export async function listProjects(): Promise<Project[]> {
  return (await load()).projects;
}

export async function getActiveProject(): Promise<Project | null> {
  const d = await load();
  return d.projects.find((p) => p.id === d.activeId) ?? null;
}

export async function getActiveId(): Promise<string | null> {
  return (await load()).activeId;
}

export async function addProject(input: {
  name: string;
  path: string;
  repoUrl?: string;
  conversationId?: string;
}): Promise<Project> {
  const d = await load();
  const proj: Project = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    path: input.path.trim(),
    repoUrl: input.repoUrl?.trim() || undefined,
    conversationId: input.conversationId,
    createdAt: Date.now(),
  };
  d.projects.push(proj);
  if (!d.activeId) d.activeId = proj.id; // ilk proje otomatik aktif
  await persist(d);
  return proj;
}

export async function getProject(id: string): Promise<Project | null> {
  return (await load()).projects.find((p) => p.id === id) ?? null;
}

export async function getProjectByConversation(
  conversationId: string,
): Promise<Project | null> {
  return (
    (await load()).projects.find((p) => p.conversationId === conversationId) ??
    null
  );
}

// Nova'nın kendi kaynak kodunu "beyin" projesi olarak garantiler ve verilen
// (sabit "ne var ne yok") sohbetine bağlar. Kaynak yolu mount edilmemişse oluşturmaz.
export async function ensureNovaProject(
  conversationId: string,
): Promise<Project | null> {
  const selfPath = process.env.NOVA_SELF_PATH || "/srv/nova-src";
  const d = await load();
  const existing = d.projects.find((p) => p.self);
  if (existing) {
    if (existing.conversationId !== conversationId) {
      existing.conversationId = conversationId;
      await persist(d);
    }
    return existing;
  }
  try {
    const st = await fs.stat(selfPath);
    if (!st.isDirectory()) return null;
  } catch {
    return null; // kaynak mount edilmemiş (ör. lokal) → oluşturma
  }
  const proj: Project = {
    id: crypto.randomUUID(),
    name: "Nova (beyin)",
    path: selfPath,
    self: true,
    conversationId,
    createdAt: Date.now(),
  };
  d.projects.push(proj);
  await persist(d);
  return proj;
}

export async function setProjectConversation(
  id: string,
  conversationId: string,
): Promise<void> {
  const d = await load();
  const proj = d.projects.find((p) => p.id === id);
  if (proj) {
    proj.conversationId = conversationId;
    await persist(d);
  }
}

export async function setActive(id: string | null): Promise<void> {
  const d = await load();
  d.activeId = id;
  await persist(d);
}

export async function removeProject(id: string): Promise<void> {
  const d = await load();
  d.projects = d.projects.filter((p) => p.id !== id);
  if (d.activeId === id) d.activeId = d.projects[0]?.id ?? null;
  await persist(d);
}

// Yolun gerçekten erişilebilir bir klasör olup olmadığını kontrol et
export async function projectExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}
