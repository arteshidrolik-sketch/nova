// Sanal Dilenci Instagram otomasyonu — durum dosyası (data/ig.json).
// Tek süreç içinde yarış olmasın diye tüm yazmalar update() kuyruğundan geçer.
import { promises as fs } from "fs";
import path from "path";

export type IgConcept = {
  klise: string; // gerçek dilenci klişesi (ör. "değnekçi")
  balon: string; // yalvaran balon metni (satır sonları \n ile)
  sahne: string; // İngilizce sahne tarifi (görsel komutuna girer)
  aciklama: string; // Instagram açıklaması
  hashtag: string; // gönderiye özel 1 hashtag (# ile)
};

export type IgStatus =
  | "awaiting_photo" // elle mod: Yücel'in Gemini'de üretip göndermesi bekleniyor
  | "generating"
  | "pending" // Telegram'da onay bekliyor
  | "approved" // yayın kuyruğunda
  | "rejected"
  | "published"
  | "failed";

export type IgItem = {
  id: string;
  createdTs: number;
  batch: string; // YYYY-MM-DD (İstanbul)
  concept: IgConcept;
  status: IgStatus;
  file?: string; // workspace/ig/<file> (balonlu, yayına hazır)
  tgMessageId?: number; // onay mesajı
  promptMsgId?: number; // elle mod: komut mesajı (fotoğraf buna yanıt olarak gelir)
  approvedTs?: number;
  publishedTs?: number;
  igMediaId?: string;
  permalink?: string;
  error?: string;
};

// Viral Yorum işi: bir Reels linki → seçilen yorumlar + Yücel'in yorumu → yorumlu Reels.
export type ViralComment = { metin: string; orijinal?: string; begeni?: string; sayfa?: boolean }; // sayfa: Yücel'in yorumu
export type ViralJob = {
  id: string;
  createdTs: number;
  url: string;
  dir: string; // workspace/ig/viral/<id>
  kaynak?: string; // "@hesap"
  status: "downloading" | "need_screens" | "review" | "await_comment" | "building" | "preview" | "publishing" | "published" | "cancelled" | "failed";
  adaylar?: ViralComment[]; // linkten + ekran görüntülerinden gelen tüm yorumlar
  yorumlar?: ViralComment[]; // seçilenler
  sayfaYorum?: string; // Yücel'in yorumu
  baslik?: string; // kaynak videonun başlığı/açıklaması (seçimde bağlam)
  aciklama?: string; // Reels açıklamasının komik cümlesi
  hashtag?: string; // konuya özel hashtag(ler)
  file?: string; // workspace/ig/<id>.mp4 (yayın için)
  previewMsgId?: number;
  permalink?: string;
  error?: string;
};

// Türkçeleştirme işi (IG_MODE=turkce): yabancı bir viral video → Türkçe altyazılı Reels.
// Ses her zaman orijinal kalır; yalnız altyazı bindirilir (Yücel, 2026-10-20).
// metin: Türkçe (üstte, beyaz) · en: İngilizce (altta, sarı) · asli: orijinal dildeki hâli
export type TrLine = { bas: number; bit: number; metin: string; en?: string; asli?: string };
export type TurkceJob = {
  id: string;
  createdTs: number;
  url: string;
  dir: string; // workspace/ig/turkce/<id>
  kaynak?: string; // "@hesap"
  status: "downloading" | "analiz" | "review" | "building" | "preview" | "publishing" | "published" | "cancelled" | "failed";
  sure?: number; // kaynak videonun süresi (sn)
  dil?: string; // konuşmanın dili (STT)
  bant?: { y: number; h: number } | null; // gömülü yabancı altyazının yeri; yoksa null
  kapat?: [number, number][]; // bandın kapatılacağı aralıklar
  altyazi?: TrLine[]; // Türkçe altyazılar
  aciklama?: string; // Reels açıklamasının komik cümlesi (Türkçe)
  aciklamaEn?: string; // aynı cümlenin İngilizcesi
  hashtag?: string; // konuya özel hashtag(ler), iki dilde
  file?: string; // workspace/ig/<id>.mp4 (yayın için)
  previewMsgId?: number;
  permalink?: string;
  error?: string;
};

export type IgState = {
  chatId?: number; // onay veren tek kullanıcı (Yücel)
  tgOffset?: number;
  igToken?: string; // yenilenmiş uzun ömürlü token (env'dekinin yerine geçer)
  igTokenRefreshedTs?: number;
  lastBatchDate?: string;
  usedSlots?: Record<string, string[]>; // tarih → kullanılan saat dilimleri
  extraSlots?: Record<string, string[]>; // tarih → o güne özel ek saatler (tek seferlik)
  items: IgItem[];
  viral?: ViralJob[];
  viralActive?: string; // Yücel'den cevap bekleyen iş
  viralVoice?: string; // seslendirme sesi (ElevenLabs voice id); yoksa VIRAL_VOICE_ID
  turkce?: TurkceJob[];
  turkceActive?: string; // Yücel'den cevap bekleyen Türkçeleştirme işi
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "ig.json");

async function read(): Promise<IgState> {
  try {
    const s = JSON.parse(await fs.readFile(FILE, "utf8")) as IgState;
    return { ...s, items: Array.isArray(s.items) ? s.items : [] };
  } catch {
    return { items: [] };
  }
}

let chain: Promise<unknown> = Promise.resolve();

export function loadIg(): Promise<IgState> {
  return read();
}

// Okuma-değiştirme-yazma; çağrılar sırayla işlenir.
export function updateIg<T>(fn: (s: IgState) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await read();
    const out = await fn(s);
    s.items = s.items.slice(-400); // dosya şişmesin
    if (s.viral) s.viral = s.viral.slice(-200);
    if (s.turkce) s.turkce = s.turkce.slice(-200);
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
    return out;
  });
  chain = run.catch(() => undefined);
  return run;
}

export async function patchViral(id: string, patch: Partial<ViralJob>): Promise<ViralJob | undefined> {
  return updateIg((s) => {
    const j = (s.viral || []).find((x) => x.id === id);
    if (j) Object.assign(j, patch);
    return j;
  });
}

export async function patchTurkce(id: string, patch: Partial<TurkceJob>): Promise<TurkceJob | undefined> {
  return updateIg((s) => {
    const j = (s.turkce || []).find((x) => x.id === id);
    if (j) Object.assign(j, patch);
    return j;
  });
}

export async function patchItem(id: string, patch: Partial<IgItem>): Promise<IgItem | undefined> {
  return updateIg((s) => {
    const it = s.items.find((i) => i.id === id);
    if (it) Object.assign(it, patch);
    return it;
  });
}
