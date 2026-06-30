// Sürüm (release) deposu — yerel dosya.
import { promises as fs } from "fs";
import path from "path";

export type ReleaseStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "live"
  | "rejected";

export type ReleaseContent = {
  changelogUser?: string;
  changelogTech?: string;
  whatsNewTr?: string;
  whatsNewEn?: string;
  aso?: { title?: string; keywords?: string; description?: string };
  generatedAt?: number;
};

export type Release = {
  id: string;
  ts: number;
  updatedAt: number;
  project: string;
  version: string;
  platform: "ios" | "android" | "web";
  status: ReleaseStatus;
  storeUrl?: string;
  rejectionReason?: string;
  fixPlan?: string;
  content?: ReleaseContent;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "releases.json");

export async function loadReleases(): Promise<Release[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function persist(all: Release[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function createRelease(input: {
  project: string;
  version: string;
  platform: Release["platform"];
}): Promise<Release> {
  const all = await loadReleases();
  const now = Date.now();
  const rel: Release = {
    id: crypto.randomUUID(),
    ts: now,
    updatedAt: now,
    project: input.project,
    version: input.version,
    platform: input.platform,
    status: "draft",
  };
  all.push(rel);
  await persist(all);
  return rel;
}

export async function getRelease(id: string): Promise<Release | undefined> {
  return (await loadReleases()).find((r) => r.id === id);
}

export async function updateRelease(
  id: string,
  patch: Partial<Release>,
): Promise<Release | undefined> {
  const all = await loadReleases();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
  await persist(all);
  return all[idx];
}

export async function deleteRelease(id: string): Promise<boolean> {
  const all = await loadReleases();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  await persist(next);
  return true;
}
