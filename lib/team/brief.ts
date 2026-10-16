// Proje kimliği (data/briefs/<proje>.md): projenin amacı, kitlesi, kuralları,
// mevcut durumu ve hedefleri. Müdür ve uzmanlar her görevde bunu okur; böylece
// ekip projeyi sohbet geçmişine bakmadan da tanır. Hafıza sekmesinden düzenlenir.
import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "briefs");
const MAX = 14000; // istem şişmesin
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

export async function getBrief(projectId?: string): Promise<string> {
  if (!projectId) return "";
  try { return (await fs.readFile(path.join(DIR, `${safe(projectId)}.md`), "utf8")).slice(0, MAX); } catch { return ""; }
}

export async function setBrief(projectId: string, text: string): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${safe(projectId)}.md`), String(text).slice(0, MAX), "utf8");
}

// İstemlere eklenecek blok (kimlik yoksa boş)
export async function briefBlock(projectId?: string): Promise<string> {
  const b = (await getBrief(projectId)).trim();
  return b ? `\n\n## PROJE KİMLİĞİ (projeyi buradan tanı; kararlarında ve üretiminde bu kurallara uy)\n${b}\n` : "";
}
