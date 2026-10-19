// Türkçeleştirme akışı (IG_MODE=turkce) — @Sanaldilenci_bot:
//  Yücel yabancı bir viral video linki atar → video indirilir → sesi ElevenLabs Scribe ile
//  yazıya dökülür → videoya gömülü yabancı altyazı varsa yeri bulunup kare kare okunur →
//  Claude ikisini birleştirip altyazıyı zamanıyla yazar (üstte Türkçe, altta İngilizce) →
//  Telegram'da liste onayı → gömülü altyazı bandı kapatılıp altyazı bindirilir →
//  önizleme + [✅ Paylaş] [❌ İptal]. Açıklama ve hashtag'ler de iki dilde.
//  SES HİÇ DEĞİŞMEZ: orijinal konuşma, efekt ve kahkaha olduğu gibi kalır (Yücel, 2026-10-20:
//  dublaj denendi, beğenilmedi).
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import * as tg from "./telegram";
import { publishReel } from "./instagram";
import { loadIg, updateIg, patchTurkce, type TrLine, type TurkceJob } from "./store";

const run = promisify(execFile);
// Bu akış Nova'nın geri kalanından ayrı bir model kullanır: işler (altyazı okuma, çeviri) Sonnet'e
// rahat geliyor ve token başına ~2,5 kat ucuz (Yücel, 2026-10-20). NOVA_MODEL'e dokunma.
const MODEL = process.env.NOVA_MODEL_TURKCE || "claude-sonnet-5-5";
const WS = path.join(process.cwd(), "workspace", "ig");
const ASSETS = path.join(process.cwd(), "assets", "ig");
const PY = process.env.NOVA_PYTHON || (process.platform === "win32" ? "python" : "python3");
const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
const FFMPEG_DIR =
  process.env.FFMPEG_DIR || (process.platform === "win32" ? "C:/Users/info/tools/ffmpeg/bin" : "");
const LINK =
  /https?:\/\/(?:www\.|m\.)?(?:instagram\.com\/(?:reel|reels|p)\/[\w-]+|youtube\.com\/shorts\/[\w-]+|youtu\.be\/[\w-]+|(?:vm\.|vt\.|www\.)?tiktok\.com\/\S+)\S*/i;
// Altyazı iki dilli olduğu için sabit hashtag'ler de iki dilde (Yücel, 2026-10-20).
const HASHTAGS = "#komik #mizah #keşfet #türkçealtyazı #funny #comedy #viral #englishsubtitles";
const EN_UZUN = 180; // sn — bundan uzun videoyu işlemeye kalkma

export const isTurkceMode = () => process.env.IG_MODE === "turkce";

// ---------- yardımcılar ----------

async function job(id?: string): Promise<TurkceJob | undefined> {
  const s = await loadIg();
  const want = id ?? s.turkceActive;
  return (s.turkce || []).find((j) => j.id === want);
}

function parseJson<T>(raw: string): T {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : raw).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(start > 0 ? body.slice(start) : body) as T;
}

function textOf(res: Anthropic.Message): string {
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

async function imageBlock(file: string): Promise<Anthropic.ImageBlockParam> {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: (await fs.readFile(file)).toString("base64") },
  };
}

function fullCaption(j: TurkceJob): string {
  const tr = j.aciklama || "Bunu çevirmeden geçemezdim 😄";
  const en = j.aciklamaEn ? `\n${j.aciklamaEn}` : "";
  return `${tr}${en}\n\n🎥 Kaynak / Source: ${j.kaynak}\nAltyazı bize ait · Subtitles by us. Videonun sahibiyseniz ve kaldırılmasını istiyorsanız DM atın.\n\n${HASHTAGS} ${j.hashtag || ""}`.trim();
}

const sn = (x: number) => `${x.toFixed(1).replace(".", ",")}`;

function listText(ls: TrLine[]): string {
  return ls
    .map((l, i) =>
      `${i + 1}) [${sn(l.bas)}–${sn(l.bit)}] ${l.metin}` +
      (l.en ? `\n   🇬🇧 ${l.en}` : "") +
      (l.asli ? `\n   (aslı: ${l.asli})` : ""))
    .join("\n");
}

const REVIEW_HELP =
  `👆 Videoya bu altyazılar girecek.\n` +
  `• Aynen kullanmak için: "tamam"\n` +
  `• Değiştirmek için ne istediğini yaz: "3: yeni metin", "5'i çıkar", "2 daha komik olsun"`;

async function showReview(id: string, chat: number, head: string): Promise<void> {
  const j = (await job(id))!;
  await patchTurkce(id, { status: "review" });
  const bilgi = j.bant
    ? `(gömülü ${j.dil || "yabancı"} altyazı kapatılacak)`
    : `(videoda gömülü altyazı yok, yazı alta gelecek)`;
  await tg.sendMessage(chat, `${head} ${bilgi}\n\n${listText(j.altyazi || [])}\n\n${REVIEW_HELP}`);
}

async function fail(id: string, chat: number, e: unknown) {
  const msg = (e as Error).message?.slice(0, 400) || String(e);
  await patchTurkce(id, { status: "failed", error: msg });
  await tg.sendMessage(chat, `⚠️ Olmadı: ${msg}`).catch(() => undefined);
}

// ---------- indirme ----------

function downloadReason(e: unknown): { msg: string; retry: boolean } {
  const err = e as Error & { stderr?: string };
  const t = `${err.stderr || ""} ${err.message || ""}`;
  if (/429|Too Many Requests|rate.?limit/i.test(t))
    return { msg: "Instagram sunucuyu geçici olarak yavaşlattı. 15–30 dakika sonra aynı linki tekrar gönder.", retry: true };
  if (/no video in this post/i.test(t))
    return { msg: "Bu gönderide video yok (fotoğraf ya da albüm). Bana video linki gönder.", retry: false };
  if (/isn't available to everyone|certain audiences|age.restrict|login required|log in|private|cookies/i.test(t))
    return { msg: "Bu video yaş sınırlı, gizli ya da giriş istiyor; hesabı riske atmamak için girişli indirme kullanmıyoruz. Başka bir video seç.", retry: false };
  return { msg: `İndirilemedi: ${(t.match(/ERROR:[^\n]*/)?.[0] || err.message || "").slice(0, 200)}`, retry: false };
}

async function download(j: TurkceJob, chat: number): Promise<void> {
  const url = /instagram\.com/i.test(j.url) ? j.url.split("?")[0] : j.url;
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(j.dir, { recursive: true });
      await run(
        YTDLP,
        [url, "--no-warnings", "--no-playlist", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
          "--merge-output-format", "mp4", "-o", path.join(j.dir, "kaynak.%(ext)s"), "--write-info-json",
          ...(FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : [])],
        { timeout: 300_000, maxBuffer: 20 * 1024 * 1024 },
      );
      await fs.access(path.join(j.dir, "kaynak.mp4"));
      return;
    } catch (e) {
      const r = downloadReason(e);
      if (!r.retry || attempt >= 2) throw new Error(r.msg);
      await tg.sendMessage(chat, "⏳ Biraz yavaşlattılar, 2 dakika bekleyip tekrar deniyorum…").catch(() => undefined);
      await new Promise((ok) => setTimeout(ok, 120_000));
    }
  }
}

async function readHandle(j: TurkceJob): Promise<string> {
  try {
    const info = JSON.parse(await fs.readFile(path.join(j.dir, "kaynak.info.json"), "utf8")) as {
      channel?: string; uploader_id?: string; uploader?: string;
    };
    const isIg = /instagram\.com/i.test(j.url);
    const h = isIg
      ? info.channel || info.uploader_id || info.uploader || "?"
      : info.uploader_id?.startsWith("@") ? info.uploader_id.slice(1) : info.channel || info.uploader || "?";
    return `@${h}`;
  } catch {
    return "@?";
  }
}

// ---------- python aracı ----------

type Meta = { genislik: number; yukseklik: number; sure: number; dil?: string; konusma: string };
type Dokum = { dil?: string; metin: string; bolumler: { bas: number; bit: number; kim: string; metin: string }[]; hata?: string };
type Bant = { y: number; h: number; aralik: [number, number][]; kareler: { t: number; grup: number }[]; gruplar: string[] };

function araci(args: string[], cwd: string, ms = 600_000) {
  return run(PY, [path.join(ASSETS, "turkcelestir.py"), ...args], {
    cwd, timeout: ms, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
}

// ---------- Claude ----------

// Kare ızgarasına bakıp videoda gömülü (yakılmış) yabancı altyazı var mı, varsa nerede?
async function bandBul(ornek: string, meta: Meta): Promise<{ y: number; h: number } | null> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{
      role: "user",
      content: [
        await imageBlock(ornek),
        {
          type: "text",
          text: `Bu görsel bir videodan alınmış 12 karenin 3x4 ızgarası (soldan sağa, yukarıdan aşağıya sırayla). Video ${meta.genislik}x${meta.yukseklik} piksel.

Sorum: bu videonun GÖRÜNTÜSÜNE gömülü (yakılmış) altyazı var mı? Yani karelerin üstünde, videonun parçası olan sabit konumlu yazı şeridi.
- Logo, kanal adı, hashtag, ürün etiketi, sahnedeki tabela/yazı ALTYAZI DEĞİLDİR.
- Altyazı birden çok dilde üst üste olabilir (ör. Çince + İngilizce); hepsini kapsayan TEK bir şerit ver.

Varsa şeridin dikey yerini kare YÜKSEKLİĞİNİN YÜZDESİ olarak ver (0 = en üst, 100 = en alt), biraz pay bırak.
SADECE JSON:
{"gomulu": true, "ust_yuzde": 58.0, "alt_yuzde": 72.0}   ya da   {"gomulu": false}`,
        },
      ],
    }],
  });
  const o = parseJson<{ gomulu?: boolean; ust_yuzde?: number; alt_yuzde?: number }>(textOf(res));
  if (!o.gomulu || o.ust_yuzde == null || o.alt_yuzde == null) return null;
  const pay = 0.015; // %1,5 pay: yazının kenarları dışarı taşmasın
  const y = Math.max(0, Math.round((o.ust_yuzde / 100 - pay) * meta.yukseklik));
  const alt = Math.min(meta.yukseklik, Math.round((o.alt_yuzde / 100 + pay) * meta.yukseklik));
  const h = Math.max(80, alt - y);
  return { y, h: Math.min(h, meta.yukseklik - y) };
}

type Ceviri = { altyazi: TrLine[]; aciklama: string; aciklamaEn?: string; hashtag: string; uygun: boolean; neden?: string };

// STT dökümü + gömülü altyazı kareleri → zamanlı Türkçe altyazı.
async function ceviriYaz(sure: number, dokum: Dokum, bant: Bant | null, dir: string): Promise<Ceviri> {
  const client = new Anthropic();
  const gorseller: Anthropic.ContentBlockParam[] = [];
  for (const g of bant?.gruplar || []) {
    gorseller.push(await imageBlock(path.join(dir, "bant", g)));
  }
  const kareBilgi = bant
    ? `Ekteki ${bant.gruplar.length} görselde videoya gömülü altyazı şeridinin kesitleri var; her kesidin üstünde SARI ile saniyesi yazılı. Aynı yazı art arda birkaç kesitte görünebilir — o zaman tek bir altyazıdır, süresi ilk ve son görüldüğü anlara göre belirlenir.`
    : `Videoda gömülü altyazı yok; zamanlamayı yalnız ses dökümünden çıkar.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        ...gorseller,
        {
          type: "text",
          text: `Yabancı bir viral videoyu İKİ DİLLİ altyazıyla paylaşacağız: üstte Türkçe, altta İngilizce. Görüntüye ve sese dokunmuyoruz; yalnız altyazı bindiriyoruz.

Video süresi: ${sure.toFixed(1)} sn. Konuşmanın dili: ${dokum.dil || "bilinmiyor"}.

${kareBilgi}

Sesin zaman damgalı dökümü (konuşmacı ayrımıyla; otomatik çıkarıldığı için hatalı olabilir):
${dokum.bolumler.map((b) => `[${b.bas}-${b.bit}] ${b.kim}: ${b.metin}`).join("\n") || "(konuşma yok)"}

Gömülü altyazının bulunduğu aralıklar (sn): ${JSON.stringify(bant?.aralik || [])}

Yapman gereken:
1. İki kaynağı birleştir. ÇELİŞİRSE GÖMÜLÜ ALTYAZI DOĞRUDUR (ses dökümü sık hata yapar, altyazı videonun kendi metnidir).
2. Her repliği HEM Türkçeye ("metin") HEM İngilizceye ("en") çevir. ASLINA SADIK ol: anlamı aynen koru, kendinden espri/kelime ekleme. İkisi de doğal, konuşma dilinde dursun; Türkçesi İngilizcesinin birebir kopyası gibi durmasın, her biri kendi dilinde akıcı olsun.
3. Zamanlama: altyazı, repliğin söylendiği anda ekranda olsun. "bas" ve "bit" saniye (ondalıklı).
   - Gömülü altyazı varsa, kapatılan aralıkların boş kalmaması için altyazıları o aralıkları dolduracak şekilde uzat (bir sonraki altyazının başına kadar).
   - En az 0,8 sn ekranda kalsın. Çakışma olmasın: her altyazının "bit"i bir sonrakinin "bas"ından küçük olsun.
4. Metin KISA olsun: iki dil alt alta yazılacağı için yer dar. Türkçe ideal ≤ 60, en çok 100 karakter; İngilizce de aynı. Uzun cümleyi iki ayrı altyazıya böl.
5. "asli": o repliğin orijinal dildeki hâli (kontrol için).
6. "aciklama": Reels için 1 kısa, komik Türkçe cümle. "aciklamaEn": aynı cümlenin İngilizcesi (çeviri gibi değil, İngilizcede de komik dursun). Kaynak ve sabit hashtag'leri ben ekleyeceğim.
7. "hashtag": konuya özel 2–4 hashtag, YARISI TÜRKÇE YARISI İNGİLİZCE (ör. "#patron #çalışan #boss #officelife").
8. "uygun": video hem Türk hem yabancı izleyiciye komik gelecek ve paylaşılabilir mi? Şiddet, cinsel içerik, gerçek bir kişiyi aşağılama, siyaset, acı/kaza içeriği varsa false ve "neden" yaz.

SADECE JSON:
{"altyazi":[{"bas":0.2,"bit":4.2,"metin":"Türkçe","en":"English","asli":"orijinal"}],"aciklama":"…","aciklamaEn":"…","hashtag":"#… #…","uygun":true}`,
        },
      ],
    }],
  });
  const o = parseJson<Ceviri>(textOf(res));
  return {
    altyazi: (o.altyazi || []).filter((l) => l?.metin && l.bit > l.bas),
    aciklama: o.aciklama || "",
    aciklamaEn: o.aciklamaEn || "",
    hashtag: o.hashtag || "",
    uygun: o.uygun !== false,
    neden: o.neden,
  };
}

async function altyaziDuzenle(current: TrLine[], talimat: string): Promise<{ altyazi: TrLine[]; hazir: boolean }> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `Bir Reels'in iki dilli altyazı listesini ("metin" Türkçe, "en" İngilizce) Yücel'in talimatına göre düzenle.

Şu anki liste:
${JSON.stringify(current, null, 1)}

Yücel'in talimatı: ${JSON.stringify(talimat)}

Kurallar:
- Talimatı aynen uygula; dışındaki hiçbir şeye dokunma. Numaralar şu anki sıradır (1'den başlar).
- Yücel bir altyazının Türkçesini değiştirirse İngilizcesini de yeni anlama uydur (ve tersi). Tek dil söylense bile ikisi aynı şeyi söylemeli.
- Zamanlara (bas/bit) ancak açıkça istenirse dokun; metin kısalınca/uzayınca zaman aynı kalır.
- Altyazı silinirse kalanların zamanı değişmez.
- "hazir": mesaj videoyu kurmayı/paylaşmayı da istiyorsa ("tamam", "kur", "hazırla", "paylaş") true.
SADECE JSON: {"altyazi":[{"bas":0.2,"bit":4.2,"metin":"…","en":"…","asli":"…"}],"hazir":false}`,
    }],
  });
  const o = parseJson<{ altyazi?: TrLine[]; hazir?: boolean }>(textOf(res));
  const altyazi = (o.altyazi || []).filter((l) => l?.metin && l.bit > l.bas);
  return { altyazi: altyazi.length ? altyazi : current, hazir: !!o.hazir };
}

// ---------- adımlar ----------

// İş klasöründeki kaynak.mp4'ü çözümler: ses dökümü + gömülü altyazı + Türkçe çeviri.
// Telegram'dan bağımsızdır; yerel denemelerde ve sunucuda arıza ararken tek başına çalıştırılabilir.
export type Cozum = Ceviri & { sure: number; dil?: string; bant: { y: number; h: number } | null; kapat: [number, number][] };

export async function cozumle(dir: string): Promise<Cozum> {
  await araci(["analiz", "kaynak.mp4", "."], dir);
  const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")) as Meta;
  const dokum = JSON.parse(await fs.readFile(path.join(dir, "dokum.json"), "utf8")) as Dokum;
  if (meta.sure > EN_UZUN) throw new Error(`Video ${Math.round(meta.sure)} sn; bu iş için fazla uzun (en çok ${EN_UZUN} sn).`);

  const bantYeri = await bandBul(path.join(dir, "ornek.jpg"), meta);
  let bant: Bant | null = null;
  if (bantYeri) {
    const out = await araci(["bant", "kaynak.mp4", ".", String(bantYeri.y), String(bantYeri.h)], dir);
    bant = JSON.parse(out.stdout.toString()) as Bant;
  }

  const c = await ceviriYaz(meta.sure, dokum, bant, dir);
  const altyazi = duzelt(c.altyazi, meta.sure);

  // Bandı YALNIZ üstüne altyazı geleceği aralıklarda kapat. Piksel taraması hareketli
  // sahnelerde (çimen, yol) ara sıra yanlış alarm veriyor; o aralıklarda Claude kareden
  // yazı okuyamadığı için altyazı da üretmiyor → kapatmak boş bir şerit bırakırdı.
  const ortusuyor = (a: number, b: number) =>
    altyazi.some((l) => l.bit > a - 0.3 && l.bas < b + 0.3);
  const kapat = (bant?.aralik || [])
    .map(([a, b]) => [Math.max(0, a - 0.15), b + 0.15] as [number, number])
    .filter(([a, b]) => ortusuyor(a, b));

  return { ...c, altyazi, sure: meta.sure, dil: dokum.dil || undefined, bant: bantYeri, kapat };
}

async function analiz(id: string, chat: number): Promise<void> {
  const j = (await job(id))!;
  await patchTurkce(id, { status: "analiz" });
  await tg.sendMessage(chat, "🔎 Sesi yazıya döküyorum ve altyazıları okuyorum (~1 dk)…");

  const c = await cozumle(j.dir);
  await patchTurkce(id, { sure: c.sure, dil: c.dil });
  if (!c.uygun) {
    await patchTurkce(id, { status: "cancelled", error: c.neden });
    await tg.sendMessage(chat, `🚫 Bu videoyu paylaşmayalım derim: ${c.neden || "uygun değil"}\n\nBaşka bir link gönderebilirsin.`);
    return;
  }
  if (!c.altyazi.length) throw new Error("Çevrilecek konuşma ya da yazı bulamadım. Başka bir video dene.");

  await patchTurkce(id, {
    bant: c.bant, kapat: c.kapat, altyazi: c.altyazi,
    aciklama: c.aciklama, aciklamaEn: c.aciklamaEn, hashtag: c.hashtag,
  });
  await showReview(id, chat, "✅ Altyazı hazır (Türkçe + İngilizce):");
}

// Çakışmaları ve taşmaları temizler (Claude'un zamanlaması her zaman tutarlı olmuyor).
function duzelt(ls: TrLine[], sure: number): TrLine[] {
  const s = [...ls].sort((a, b) => a.bas - b.bas);
  for (let i = 0; i < s.length; i++) {
    s[i].bas = Math.max(0, Math.min(s[i].bas, sure - 0.5));
    s[i].bit = Math.min(Math.max(s[i].bit, s[i].bas + 0.8), sure);
    const sonraki = s[i + 1];
    if (sonraki && s[i].bit > sonraki.bas - 0.05) s[i].bit = Math.max(s[i].bas + 0.5, sonraki.bas - 0.05);
  }
  return s.filter((l) => l.bit > l.bas);
}

async function build(id: string, chat: number): Promise<void> {
  const j = (await job(id))!;
  await patchTurkce(id, { status: "building" });
  await tg.sendMessage(chat, "🎬 Video kuruluyor (~1 dk)…");
  await fs.writeFile(
    path.join(j.dir, "is.json"),
    JSON.stringify({ video: "kaynak.mp4", bant: j.bant || null, kapat: j.kapat || [],
      altyazi: (j.altyazi || []).map((l) => ({ bas: l.bas, bit: l.bit, metin: l.metin, en: l.en || "" })) }, null, 1),
    "utf8",
  );
  await araci(["kur", "is.json", "cikti.mp4"], j.dir);

  const file = `${id}.mp4`;
  await fs.copyFile(path.join(j.dir, "cikti.mp4"), path.join(WS, file));
  const caption = fullCaption((await job(id))!);
  const msg = await tg.sendVideo(chat, path.join(WS, file), `👀 Önizleme\n\n${caption}`, [
    [{ text: "✅ Paylaş", callback_data: `tr_ok:${id}` }, { text: "❌ İptal", callback_data: `tr_no:${id}` }],
  ]);
  await patchTurkce(id, { status: "preview", file, previewMsgId: msg.message_id });
  await tg.sendMessage(chat, "Beğendiysen ✅ Paylaş'a bas. Altyazıda değişiklik istersen yaz, yeniden kurarım.");
}

async function startJob(chat: number, url: string): Promise<void> {
  const id = `tr-${Date.now().toString(36)}`;
  const j: TurkceJob = { id, createdTs: Date.now(), url, dir: path.join(WS, "turkce", id), status: "downloading" };
  await updateIg((s) => {
    s.turkce = [...(s.turkce || []), j];
    s.turkceActive = id;
  });
  await tg.sendMessage(chat, "⏳ Linki aldım, video iniyor…");
  try {
    await download(j, chat);
    await patchTurkce(id, { kaynak: await readHandle(j) });
    await analiz(id, chat);
  } catch (e) {
    await fail(id, chat, e);
  }
}

async function publish(id: string, chat: number, cbId: string): Promise<void> {
  const j = await job(id);
  if (!j || j.status !== "preview" || !j.file) {
    await tg.answerCallback(cbId, "Bu video zaten işlendi.");
    return;
  }
  await tg.answerCallback(cbId, "Paylaşılıyor…");
  await patchTurkce(id, { status: "publishing" });
  if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "⏳ Instagram'a yükleniyor…");
  try {
    const r = await publishReel(j.file, fullCaption(j));
    await patchTurkce(id, { status: "published", permalink: r.permalink });
    await updateIg((s) => void (s.turkceActive = s.turkceActive === id ? undefined : s.turkceActive));
    if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, `✅ Paylaşıldı: ${r.permalink || ""}`);
    await tg.sendMessage(chat, `📤 Yayında: ${r.permalink || "(bağlantı alınamadı)"}\n\nYeni link gönderebilirsin.`);
  } catch (e) {
    await patchTurkce(id, { status: "preview", error: (e as Error).message.slice(0, 300) });
    await tg.sendMessage(chat, `⚠️ Paylaşılamadı: ${(e as Error).message}\nTekrar denemek için ✅ Paylaş'a bas.`);
  }
}

// ---------- giriş noktası ----------

export async function turkceHandle(chat: number, u: tg.TgUpdate): Promise<void> {
  const q = u.callback_query;
  if (q?.data?.startsWith("tr_")) {
    const [act, id] = q.data.split(":");
    if (act === "tr_ok") void publish(id, chat, q.id);
    else if (act === "tr_no") {
      await patchTurkce(id, { status: "cancelled" });
      await updateIg((s) => void (s.turkceActive = s.turkceActive === id ? undefined : s.turkceActive));
      await tg.answerCallback(q.id, "İptal edildi");
      const j = await job(id);
      if (j?.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "❌ İptal edildi");
    }
    return;
  }
  const m = u.message;
  if (!m) return;

  const text = (m.text || m.caption || "").trim();
  const link = text.match(LINK)?.[0];
  if (link) {
    void startJob(chat, link);
    return;
  }

  const j = await job();
  const ok = /^(tamam|aynen|ok|okey|olur|evet|devam|onay|kur|kurabilirsin|paylaş)\b/i.test(text);
  if (j?.status === "review") {
    if (ok) {
      void build(j.id, chat).catch((e) => fail(j.id, chat, e));
    } else {
      void (async () => {
        const { altyazi, hazir } = await altyaziDuzenle(j.altyazi || [], text);
        await patchTurkce(j.id, { altyazi: duzelt(altyazi, j.sure || 0) });
        if (!hazir) return showReview(j.id, chat, "✏️ Güncel altyazı:");
        await build(j.id, chat);
      })().catch((e) => fail(j.id, chat, e));
    }
    return;
  }
  if (j?.status === "preview" && !ok) {
    if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "🔁 Değişiklik istendi, yenisi hazırlanıyor…");
    void (async () => {
      const { altyazi } = await altyaziDuzenle(j.altyazi || [], text);
      await patchTurkce(j.id, { altyazi: duzelt(altyazi, j.sure || 0) });
      await tg.sendMessage(chat, `✏️ Yeni altyazı:\n\n${listText((await job(j.id))!.altyazi || [])}`);
      await build(j.id, chat);
    })().catch((e) => fail(j.id, chat, e));
    return;
  }
  if (j && ["downloading", "analiz", "building", "publishing"].includes(j.status)) {
    await tg.sendMessage(chat, "⏳ Hâlâ üzerinde çalışıyorum, birazdan haber veririm.");
    return;
  }
  await tg.sendMessage(
    chat,
    "🥺 Bana yabancı bir viral video linki gönder (Instagram, TikTok ya da YouTube Shorts).\n" +
      "1) Sesini ve gömülü altyazısını okuyup altyazıyı çıkarırım (üstte Türkçe, altta İngilizce) → \"tamam\" ya da değişikliğini yaz\n" +
      "2) Videoyu kurup önizleme gönderirim → ✅ Paylaş\n" +
      "🔊 Ses hiç değişmez; orijinal konuşma ve kahkahalar olduğu gibi kalır.",
  );
}
