// Fatura okuma ucu — "kesin çözüm" hattı:
// POST  : yüklenen fotoğraf/PDF'i Claude'a ZORUNLU JSON şemayla okutur,
//         aritmetik doğrulama yapar, alanları + uyarıları döner (kaydetmez).
// PUT   : kullanıcının kontrol ettiği alanları fatura defterine kaydeder.
// GET   : kayıt listesi; ?excel=1 → defteri xlsx olarak indirir.
// DELETE: ?id=... kaydı siler.
//
// Neden böyle: tarayıcı-içi OCR (tesseract) Türkçe faturalarda güvenilmez.
// Claude görüntü/PDF'ten şema-zorunlu çıkarım + toplama/çarpma sağlaması +
// insan onayı üçlüsü, pratikte "saçma sonuç" ihtimalini kapatır.
import Anthropic from "@anthropic-ai/sdk";
import {
  addInvoice,
  deleteInvoice,
  listInvoices,
  type InvoiceFields,
  type InvoiceItem,
} from "@/lib/invoices/store";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXTRACT_MODEL =
  process.env.NOVA_INVOICE_MODEL || process.env.NOVA_MODEL || "claude-opus-4-8";

// Claude'un doldurmak ZORUNDA olduğu fatura şeması (tool forcing).
const INVOICE_TOOL = {
  name: "fatura_ver",
  description:
    "Belgeden okunan fatura alanlarını yapılandırılmış olarak teslim et.",
  input_schema: {
    type: "object" as const,
    properties: {
      fatura_no: { type: ["string", "null"] },
      tarih: {
        type: ["string", "null"],
        description: "GG.AA.YYYY biçiminde fatura tarihi",
      },
      satici: { type: ["string", "null"], description: "Satıcı ünvanı" },
      satici_vkn: { type: ["string", "null"], description: "Satıcı VKN/TCKN" },
      alici: { type: ["string", "null"], description: "Alıcı ünvanı" },
      alici_vkn: { type: ["string", "null"], description: "Alıcı VKN/TCKN" },
      para_birimi: { type: ["string", "null"], description: "TRY, USD, EUR…" },
      kalemler: {
        type: "array",
        items: {
          type: "object",
          properties: {
            aciklama: { type: "string", description: "Ürün/hizmet adı" },
            miktar: { type: ["number", "null"] },
            birim: { type: ["string", "null"], description: "Adet, kg, m…" },
            birim_fiyat: { type: ["number", "null"] },
            kdv_orani: { type: ["number", "null"], description: "Yüzde: 20 gibi" },
            tutar: { type: ["number", "null"], description: "Satır toplamı (KDV hariç)" },
          },
          required: ["aciklama"],
        },
      },
      mal_hizmet_toplam: { type: ["number", "null"] },
      iskonto: { type: ["number", "null"] },
      kdv_toplam: { type: ["number", "null"] },
      genel_toplam: { type: ["number", "null"], description: "Ödenecek tutar" },
    },
    required: ["kalemler"],
  },
};

const EXTRACT_PROMPT =
  "Sen Türkçe fatura okuma uzmanısın (e-Arşiv, e-Fatura, irsaliyeli fatura, fiş). " +
  "Ekteki belge bir faturadır; TÜM alanları ve kalem tablosundaki TÜM satırları oku, " +
  "fatura_ver aracıyla teslim et.\n" +
  "KURALLAR:\n" +
  "- SADECE belgede fiilen okuduğunu yaz. Okunamayan/olmayan alana null koy — ASLA tahmin etme, uydurma.\n" +
  "- Sayıları Türk biçiminden çevir: '1.234,56' → 1234.56. Para işaretlerini sayıya katma.\n" +
  "- Kalem tablosunda hiçbir satırı atlama; miktar/adet sütununu özellikle dikkatli oku.\n" +
  "- BİRİM: Türk faturalarında miktar ve birim çoğu zaman AYNI hücrede yazar ('2 Adet', '1,5 KG', '3 MT', '10 AD', 'C62' kodu = Adet). Bunu ayrıştır: miktar=2, birim='Adet'. Ayrı 'Birim' sütunu varsa oradan al; kısaltmaları aç (AD/ADET→Adet, KG→kg, MT/M→m, LT→lt, PK→Paket, KT→Koli). Belgede gerçekten hiçbir birim yazmıyorsa ve kalemler sayılabilir ürünse 'Adet' yaz.\n" +
  "- Görsel bulanıksa okunduğu kadarını ver; emin olmadığın rakamı null bırak.\n" +
  "- Belge birden çok parça/görüntüden oluşuyorsa hepsi AYNI faturadır; birleştirerek oku.";

type Page = { data: string; mediaType: string };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeFields(raw: Record<string, unknown>): InvoiceFields {
  const kalemler: InvoiceItem[] = Array.isArray(raw.kalemler)
    ? (raw.kalemler as Record<string, unknown>[]).map((k) => ({
        aciklama: String(k.aciklama ?? "").trim(),
        miktar: num(k.miktar),
        birim: k.birim ? String(k.birim) : null,
        birim_fiyat: num(k.birim_fiyat),
        kdv_orani: num(k.kdv_orani),
        tutar: num(k.tutar),
      }))
    : [];
  const s = (v: unknown) => (v ? String(v).trim() : null);
  return {
    fatura_no: s(raw.fatura_no),
    tarih: s(raw.tarih),
    satici: s(raw.satici),
    satici_vkn: s(raw.satici_vkn),
    alici: s(raw.alici),
    alici_vkn: s(raw.alici_vkn),
    para_birimi: s(raw.para_birimi) || "TRY",
    kalemler,
    mal_hizmet_toplam: num(raw.mal_hizmet_toplam),
    iskonto: num(raw.iskonto),
    kdv_toplam: num(raw.kdv_toplam),
    genel_toplam: num(raw.genel_toplam),
  };
}

// Aritmetik sağlama: model ne derse desin rakamlar TUTARLI olmalı.
// Tutmayan her şey uyarı olarak kullanıcıya gösterilir (insan onayı hattı).
function validate(f: InvoiceFields): string[] {
  const w: string[] = [];
  const tol = (x: number) => Math.max(0.05, Math.abs(x) * 0.01);
  f.kalemler.forEach((k, i) => {
    if (k.miktar !== null && k.birim_fiyat !== null && k.tutar !== null) {
      const beklenen = k.miktar * k.birim_fiyat;
      if (Math.abs(beklenen - k.tutar) > tol(k.tutar)) {
        w.push(
          `Kalem ${i + 1} (${k.aciklama.slice(0, 30)}): miktar × birim fiyat = ${beklenen.toFixed(2)} ama satır tutarı ${k.tutar.toFixed(2)} — kontrol et.`,
        );
      }
    }
  });
  const satirToplam = f.kalemler.reduce((a, k) => a + (k.tutar ?? 0), 0);
  if (
    f.mal_hizmet_toplam !== null &&
    f.kalemler.some((k) => k.tutar !== null) &&
    Math.abs(satirToplam - f.mal_hizmet_toplam) > tol(f.mal_hizmet_toplam)
  ) {
    w.push(
      `Kalemlerin toplamı ${satirToplam.toFixed(2)} ama mal/hizmet toplamı ${f.mal_hizmet_toplam.toFixed(2)} — bir satır eksik ya da yanlış okunmuş olabilir.`,
    );
  }
  if (
    f.mal_hizmet_toplam !== null &&
    f.kdv_toplam !== null &&
    f.genel_toplam !== null
  ) {
    const beklenen = f.mal_hizmet_toplam - (f.iskonto ?? 0) + f.kdv_toplam;
    if (Math.abs(beklenen - f.genel_toplam) > tol(f.genel_toplam)) {
      w.push(
        `Mal/hizmet − iskonto + KDV = ${beklenen.toFixed(2)} ama ödenecek tutar ${f.genel_toplam.toFixed(2)} — kontrol et.`,
      );
    }
  }
  if (f.kalemler.length === 0) w.push("Hiç kalem okunamadı — belge fatura mı?");
  return w;
}

// POST — çıkarım (kaydetmez; sonuç kullanıcı onayına gider)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    pages?: Page[];
  };
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, 6) : [];
  if (!pages.length || !pages.every((p) => p?.data && p?.mediaType)) {
    return Response.json({ error: "Dosya verisi eksik." }, { status: 400 });
  }

  const blocks: unknown[] = pages.map((p) =>
    p.mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: p.data },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: p.mediaType, data: p.data },
        },
  );
  blocks.push({ type: "text", text: EXTRACT_PROMPT });

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 8000,
      tools: [INVOICE_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "fatura_ver" },
      messages: [
        { role: "user", content: blocks as Anthropic.ContentBlockParam[] },
      ],
    });
    const toolUse = resp.content.find((b) => b.type === "tool_use") as
      | { input?: Record<string, unknown> }
      | undefined;
    if (!toolUse?.input) {
      return Response.json(
        { error: "Model yapılandırılmış sonuç dönmedi." },
        { status: 502 },
      );
    }
    const fields = normalizeFields(toolUse.input);
    return Response.json({ fields, uyarilar: validate(fields) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Çıkarım hatası" },
      { status: 500 },
    );
  }
}

// PUT — kullanıcı onayladı: deftere kaydet
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    fields?: Record<string, unknown>;
    kaynak?: string;
  };
  if (!body.fields) {
    return Response.json({ error: "Alanlar eksik." }, { status: 400 });
  }
  const fields = normalizeFields(body.fields);
  const rec = await addInvoice(
    fields,
    String(body.kaynak ?? "bilinmiyor"),
    validate(fields),
  );
  return Response.json({ record: rec });
}

// GET — liste ya da Excel dışa aktarım
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = await listInvoices();

  if (!url.searchParams.get("excel")) {
    return Response.json({ invoices: all });
  }

  const { Workbook } = await import("exceljs");
  const wb = new Workbook();

  const ozet = wb.addWorksheet("Faturalar");
  ozet.columns = [
    { header: "Tarih", key: "tarih", width: 12 },
    { header: "Fatura No", key: "no", width: 20 },
    { header: "Satıcı", key: "satici", width: 32 },
    { header: "Satıcı VKN", key: "vkn", width: 14 },
    { header: "Mal/Hizmet", key: "mh", width: 14 },
    { header: "İskonto", key: "isk", width: 12 },
    { header: "KDV", key: "kdv", width: 12 },
    { header: "Ödenecek", key: "genel", width: 14 },
    { header: "Para", key: "pb", width: 8 },
    { header: "Kaynak dosya", key: "kaynak", width: 26 },
  ];
  ozet.getRow(1).font = { bold: true };
  for (const r of all) {
    ozet.addRow({
      tarih: r.tarih ?? "",
      no: r.fatura_no ?? "",
      satici: r.satici ?? "",
      vkn: r.satici_vkn ?? "",
      mh: r.mal_hizmet_toplam ?? "",
      isk: r.iskonto ?? "",
      kdv: r.kdv_toplam ?? "",
      genel: r.genel_toplam ?? "",
      pb: r.para_birimi ?? "TRY",
      kaynak: r.kaynak,
    });
  }

  const kalem = wb.addWorksheet("Kalemler");
  kalem.columns = [
    { header: "Tarih", key: "tarih", width: 12 },
    { header: "Fatura No", key: "no", width: 20 },
    { header: "Satıcı", key: "satici", width: 28 },
    { header: "Açıklama", key: "ack", width: 40 },
    { header: "Miktar", key: "miktar", width: 10 },
    { header: "Birim", key: "birim", width: 10 },
    { header: "Birim Fiyat", key: "bf", width: 12 },
    { header: "KDV %", key: "kdv", width: 8 },
    { header: "Tutar", key: "tutar", width: 12 },
  ];
  kalem.getRow(1).font = { bold: true };
  for (const r of all) {
    for (const k of r.kalemler) {
      kalem.addRow({
        tarih: r.tarih ?? "",
        no: r.fatura_no ?? "",
        satici: r.satici ?? "",
        ack: k.aciklama,
        miktar: k.miktar ?? "",
        birim: k.birim ?? "",
        bf: k.birim_fiyat ?? "",
        kdv: k.kdv_orani ?? "",
        tutar: k.tutar ?? "",
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="fatura_defteri.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id gerekli" }, { status: 400 });
  const ok = await deleteInvoice(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "bulunamadı" }, { status: 404 });
}
