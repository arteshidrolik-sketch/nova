// Proje kimliği (data/briefs/<proje>.md): projenin amacı, kitlesi, kuralları,
// mevcut durumu ve hedefleri. Müdür ve uzmanlar her görevde bunu okur; böylece
// ekip projeyi sohbet geçmişine bakmadan da tanır. Hafıza sekmesinden düzenlenir.
import { promises as fs } from "fs";
import path from "path";
import { summaryText } from "@/lib/youtube/stats";

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

// İstemlere eklenecek blok: kimlik + (bağlıysa) YouTube kanalının güncel rakamları
export async function briefBlock(projectId?: string): Promise<string> {
  const b = (await getBrief(projectId)).trim();
  const yt = projectId ? await summaryText(projectId).catch(() => "") : "";
  return (
    (b ? `\n\n## PROJE KİMLİĞİ (projeyi buradan tanı; kararlarında ve üretiminde bu kurallara uy)\n${b}\n` : "") +
    (yt ? `\n## KANALIN GÜNCEL RAKAMLARI (otomatik ölçüm — gelişmeyi buradan takip et, plan ve önerilerini bu verilere dayandır)\n${yt}\n` : "")
  );
}
