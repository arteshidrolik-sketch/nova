// Office/PDF dosyalarını sunucuda metne çevirir (form alanlarına yüklenebilsin).
// @ts-ignore - mammoth tip dosyası yok
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import AdmZip from "adm-zip";

// XML metin varlıklarını çöz (& < > " ')
function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "");
  const data = String(body?.data ?? "");
  if (!data) return Response.json({ error: "no_data" }, { status: 400 });

  const buf = Buffer.from(data, "base64");

  try {
    if (/\.docx$/i.test(name)) {
      const r = await mammoth.extractRawText({ buffer: buf });
      return Response.json({ text: String(r?.value ?? "") });
    }
    if (/\.(xlsx|xls)$/i.test(name)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      let txt = "";
      for (const s of wb.SheetNames) {
        txt += `# ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}\n\n`;
      }
      return Response.json({ text: txt });
    }
    if (/\.pdf$/i.test(name)) {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const out = Array.isArray(text) ? text.join("\n") : String(text ?? "");
      return Response.json({ text: out });
    }
    if (/\.pptx$/i.test(name)) {
      // pptx = zip; her slaytın metnini ppt/slides/slideN.xml içindeki
      // <a:t> parçalarından sırayla topla.
      const zip = new AdmZip(buf);
      const slides = zip
        .getEntries()
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => {
          const na = parseInt(a.entryName.match(/slide(\d+)\.xml/i)?.[1] ?? "0", 10);
          const nb = parseInt(b.entryName.match(/slide(\d+)\.xml/i)?.[1] ?? "0", 10);
          return na - nb;
        });
      let txt = "";
      slides.forEach((e, i) => {
        const xml = e.getData().toString("utf8");
        const runs = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) =>
          decodeXml(m[1]),
        );
        const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
        txt += `# Slayt ${i + 1}\n${slideText}\n\n`;
      });
      return Response.json({ text: txt.trim() || "(sunumda metin bulunamadı)" });
    }
    return Response.json({ error: "unsupported" }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "extract_failed" },
      { status: 500 },
    );
  }
}
