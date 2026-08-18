// Fatura defteri — yerel dosya deposu (data/invoices.json).
// Fatura sekmesinden onaylanan kayıtlar burada birikir; Excel dışa aktarım
// bu kayıtlardan üretilir.
import { promises as fs } from "fs";
import path from "path";

export type InvoiceItem = {
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  birim_fiyat: number | null;
  kdv_orani: number | null;
  tutar: number | null;
};

export type InvoiceFields = {
  fatura_no: string | null;
  tarih: string | null; // GG.AA.YYYY
  satici: string | null;
  satici_vkn: string | null;
  alici: string | null;
  alici_vkn: string | null;
  para_birimi: string | null;
  kalemler: InvoiceItem[];
  mal_hizmet_toplam: number | null;
  iskonto: number | null;
  kdv_toplam: number | null;
  genel_toplam: number | null;
};

export type InvoiceRecord = InvoiceFields & {
  id: string;
  createdAt: number;
  kaynak: string; // yüklenen dosyanın adı
  uyarilar: string[]; // aritmetik doğrulama uyarıları (kayıt anındaki)
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "invoices.json");

export async function listInvoices(): Promise<InvoiceRecord[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function persist(all: InvoiceRecord[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function addInvoice(
  fields: InvoiceFields,
  kaynak: string,
  uyarilar: string[],
): Promise<InvoiceRecord> {
  const all = await listInvoices();
  const rec: InvoiceRecord = {
    ...fields,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kaynak,
    uyarilar,
  };
  all.unshift(rec);
  await persist(all);
  return rec;
}

export async function deleteInvoice(id: string): Promise<boolean> {
  const all = await listInvoices();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  await persist(next);
  return true;
}
