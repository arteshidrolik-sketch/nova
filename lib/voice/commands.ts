// Nova sesli komut çözümleyici: konuşulan cümleden ne yapılacağını çıkarır.
// Gezinme (proje aç, evrene dön, sekme aç) ve "sus" arayüzde yapılır; geri kalan
// her şey açık projenin müdürüne iş olarak gönderilir.

export type TabKey = "sohbet" | "dosyalar" | "fatura" | "hafiza" | "raporlar" | "beceriler" | "gorevler";
export type VoiceCommand =
  | { type: "stop" }
  | { type: "sleep" }
  | { type: "home" }
  | { type: "project"; id: string; title: string }
  | { type: "tab"; key: TabKey; label: string }
  | { type: "work"; text: string };

// Türkçe sadeleştirme: küçük harf, ASCII, yalnız harf/rakam/boşluk
export function normTr(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAV_VERB = /(^|\s)(ac|acar|git|gec|goster|gel|getir|don|gir|bak)\w*(\s|$)/;
const TABS: [RegExp, TabKey, string][] = [
  [/(^|\s)(ekip|sohbet|ofis|mudur)\w*/, "sohbet", "Ekip"],
  [/(^|\s)dosya\w*/, "dosyalar", "Dosyalar"],
  [/(^|\s)fatura\w*/, "fatura", "Fatura"],
  [/(^|\s)hafiza\w*/, "hafiza", "Hafıza"],
  [/(^|\s)rapor\w*/, "raporlar", "Raporlar"],
  [/(^|\s)beceri\w*/, "beceriler", "Beceriler"],
  [/(^|\s)(onay|gorev)\w*/, "gorevler", "Onaylar"],
];

// "Nova" uyandırma sözcüğü ve STT'nin sık yanlış yazımları
const WAKE = /(^|\s)(nova|novva|nowa|noa|nuva|nove|novaa)(\s|$)/;
export function findWake(text: string): { hit: boolean; rest: string } {
  const n = normTr(text);
  const m = n.match(WAKE);
  if (!m || m.index === undefined) return { hit: false, rest: "" };
  // komutu ORİJİNAL yazımıyla döndür (Türkçe karakterler ve büyük harf korunsun)
  const raw = text.replace(/^[\s\S]*?(?:^|[^\p{L}])(nova|novva|nowa|noa|nuva|nove|novaa)(?![\p{L}])[\s,.:;!?\-–]*/iu, "").trim();
  return { hit: true, rest: raw || n.slice(m.index + m[0].length).trim() };
}

export function parseCommand(raw: string, projects: { id: string; title: string }[], inProject: boolean): VoiceCommand | null {
  const n = normTr(raw);
  if (!n) return null;
  const words = n.split(" ");
  const short = words.length <= 4;
  if (/^(sus|dur|yeter|tamam sus|sessiz ol|kes)(\s|$)/.test(n)) return { type: "stop" };
  if (/(dinlemeyi (birak|kapat)|uyu|uyku moduna gec|beni dinleme)/.test(n)) return { type: "sleep" };
  const nav = NAV_VERB.test(n) || short;
  if (nav && /(evren|ana sayfa|anasayfa|ana ekran|geri don|projelerden cik|cikis)/.test(n)) return { type: "home" };
  // proje adı: başlığın tamamı ya da ilk anlamlı kelimesi geçiyorsa
  if (nav) {
    let best: { id: string; title: string; score: number } | null = null;
    for (const p of projects) {
      const t = normTr(p.title);
      const first = t.split(" ").find((w) => w.length >= 3) ?? t;
      const score = n.includes(t) ? t.length + 10 : n.split(" ").some((w) => w === first || (first.length >= 4 && w.startsWith(first.slice(0, Math.max(4, first.length - 2))))) ? first.length : 0;
      if (score && (!best || score > best.score)) best = { id: p.id, title: p.title, score };
    }
    // "projesine/proje" geçiyorsa ya da kısa ifade → proje gezinmesi
    if (best && (/proje/.test(n) || short || NAV_VERB.test(n))) return { type: "project", id: best.id, title: best.title };
  }
  if (inProject && nav) {
    for (const [re, key, label] of TABS) if (re.test(n) && (/sekme/.test(n) || NAV_VERB.test(n) || short)) return { type: "tab", key, label };
  }
  return { type: "work", text: raw.trim() };
}
