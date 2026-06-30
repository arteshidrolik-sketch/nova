// Office dosyalarını (docx/xlsx/xls) sunucuda metne çevirir (Claude binary okuyamaz).
// @ts-ignore - mammoth tip dosyası yok
import mammoth from "mammoth";
import * as XLSX from "xlsx";

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
    return Response.json({ error: "unsupported" }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "extract_failed" },
      { status: 500 },
    );
  }
}
