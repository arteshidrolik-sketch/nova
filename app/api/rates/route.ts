// Günlük döviz kuru — sunucu tarafında çekilir (tarayıcıdan doğrudan TCMB'ye
// istek CORS'a takıldığı için). Önce TCMB (today.xml), erişilemezse (hafta sonu/
// tatil/15:30 öncesi 404 olabilir) ECB/frankfurter'a düşülür.

export const runtime = "nodejs";
export const revalidate = 1800; // 30 dk — kur günde bir güncellenir

type Rates = { eur: number | null; usd: number | null; date: string; source: string };

// Bir para biriminin <ForexSelling> (döviz satış) değerini XML'den çıkar.
// indexOf ile ilgili <Currency> bloğunu izole eder (regex kaçış tuzağı yok).
function forexSelling(xml: string, kod: string): number | null {
  const start = xml.indexOf(`Kod="${kod}"`);
  if (start === -1) return null;
  const end = xml.indexOf("</Currency>", start);
  const block = end === -1 ? xml.slice(start) : xml.slice(start, end);
  const m = /<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block);
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

async function fromTCMB(): Promise<Rates | null> {
  try {
    const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", {
      headers: { "User-Agent": "Nova/1.0 (+https://nova.getdriver.com.tr)" },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const eur = forexSelling(xml, "EUR");
    const usd = forexSelling(xml, "USD");
    if (eur == null && usd == null) return null;
    const date = /Tarih="([^"]+)"/.exec(xml)?.[1] ?? "";
    return { eur, usd, date, source: "TCMB" };
  } catch {
    return null;
  }
}

async function fromFrankfurter(): Promise<Rates | null> {
  try {
    const [eurRes, usdRes] = await Promise.all([
      fetch("https://api.frankfurter.app/latest?base=EUR&symbols=TRY", {
        next: { revalidate: 1800 },
      }).then((r) => r.json()),
      fetch("https://api.frankfurter.app/latest?base=USD&symbols=TRY", {
        next: { revalidate: 1800 },
      }).then((r) => r.json()),
    ]);
    const eur = eurRes?.rates?.TRY ?? null;
    const usd = usdRes?.rates?.TRY ?? null;
    if (eur == null && usd == null) return null;
    return { eur, usd, date: eurRes?.date ?? "", source: "ECB" };
  } catch {
    return null;
  }
}

export async function GET() {
  const rates = (await fromTCMB()) ?? (await fromFrankfurter());
  if (!rates) {
    return Response.json(
      { eur: null, usd: null, date: "", source: "yok", error: "rates_unavailable" },
      { status: 502 },
    );
  }
  return Response.json(rates);
}
