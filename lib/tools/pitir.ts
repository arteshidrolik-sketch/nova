// Pıtır TV → Pıtır botu köprüsü. Nova ekibinin hazırladığı senaryoları, aynı
// sunucuda çalışan Pıtır botunun gelen kutusuna (PITIR_INBOX → sunucuda
// /home/pitir/Projelerim/Çocuk Shorts/nova-gelen) bırakır ve Pıtır botunun kendi
// hesabından kullanıcıya Telegram'da haber verir. Üretimi bot yapar; her adımda
// kullanıcıdan onay almaya devam eder (bu araç yalnız teslim eder, üretim başlatmaz).
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";

export type PitirScript = { baslik: string; metin?: string; dosya?: string; numara?: number };

export function pitirConfigured(): boolean {
  return !!(process.env.PITIR_INBOX && process.env.PITIR_PROJECT_ID);
}

// Bu araç yalnız Pıtır TV projesinde kullanılır (workspace kapsamı c-<proje ilk 8>/)
export function isPitirScope(scope: string): boolean {
  const id = process.env.PITIR_PROJECT_ID ?? "";
  return !!id && scope.replace(/\/$/, "") === `c-${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
}

const slug = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "senaryo";

// .docx → düz metin: paragraflar ayrı satır; tablo satırları tek satır "hücre | hücre | …"
// (replik tablosu "1 | Selma | [warmly] | metin" biçiminde gelir → bot kolayca replikler.tsv'ye çevirir)
async function docxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  let xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const cellText = (x: string) => x.replace(/<w:tab\/>/g, " ").replace(/<\/w:p>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  xml = xml.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, (row) => {
    const cells = [...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((m) => cellText(m[0]));
    return `<w:p>${cells.join(" | ")}</w:p>`;
  });
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

async function readScriptFile(fullPath: string): Promise<string> {
  const buf = await fs.readFile(fullPath);
  return /\.docx$/i.test(fullPath) ? docxText(buf) : buf.toString("utf8");
}

async function telegram(text: string): Promise<boolean> {
  const token = process.env.PITIR_BOT_TOKEN, chat = process.env.PITIR_CHAT_ID;
  if (!token || !chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  return !!r?.ok;
}

// resolve: workspace dosya adını tam yola çevirir (aksiyon katmanı verir)
export async function sendToPitirBot(items: PitirScript[], resolve: (name: string) => string): Promise<string> {
  const inbox = process.env.PITIR_INBOX;
  if (!inbox) throw new Error("Pıtır gelen kutusu tanımlı değil (PITIR_INBOX)");
  if (!items.length) throw new Error("gönderilecek senaryo yok");
  await fs.mkdir(inbox, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const written: string[] = [];
  for (const [i, it] of items.entries()) {
    let body = (it.metin ?? "").trim();
    if (!body && it.dosya) body = (await readScriptFile(resolve(it.dosya))).trim();
    if (body.length < 40) throw new Error(`"${it.baslik}" için senaryo metni boş ya da çok kısa`);
    const no = it.numara ?? i + 1;
    const name = `${stamp}-${String(no).padStart(2, "0")}-${slug(it.baslik)}.md`;
    const md =
      `---\nkaynak: Nova (Pıtır TV ekibi)\ndurum: yeni\nnumara: ${no}\nbaslik: ${JSON.stringify(it.baslik)}\ntarih: ${new Date().toISOString()}\n---\n\n` +
      `# ${it.baslik}\n\n${body}\n`;
    await fs.writeFile(path.join(inbox, name), md, "utf8");
    written.push(`${String(no).padStart(2, "0")} · ${it.baslik}`);
  }
  const list = written.slice(0, 30).map((w) => `• ${w}`).join("\n");
  const msg =
    `📥 Nova'dan ${written.length} yeni senaryo geldi (nova-gelen kutusu):\n${list}${written.length > 30 ? `\n… +${written.length - 30}` : ""}\n\n` +
    `Üretime başlamak için yaz: "Nova senaryolarını üret" (sırayla, her adımda onayını alırım) ya da tek tek: "Nova senaryosu ${String(items[0].numara ?? 1).padStart(2, "0")}".`;
  const sent = await telegram(msg);
  return `✅ ${written.length} senaryo Pıtır botunun gelen kutusuna bırakıldı${sent ? " ve kullanıcıya Pıtır botundan Telegram bildirimi gitti" : " (Telegram bildirimi gönderilemedi — kullanıcıya botta 'Nova senaryolarını üret' yazmasını söyle)"}:\n${written.map((w) => `- ${w}`).join("\n")}\nÜretim kullanıcının Telegram'daki onaylarıyla botta yapılır.`;
}
