// Viral Yorum akışı (IG_MODE=viral) — @Sanaldilenci_bot:
//  Yücel Reels linki atar → video + görünen yorumlar indirilir → Claude en komik gerçek
//  yorumları seçer (aslına sadık çeviri) → yetmezse ekran görüntüsü istenir → Yücel'e
//  "senin yorumun?" sorulur → yorumlu video kurulur (assets/ig/yorumlu.py) → Telegram'da
//  önizleme + [✅ Paylaş] [❌ İptal] → onaylanınca Instagram Reels olarak yayınlanır.
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import * as tg from "./telegram";
import { publishReel } from "./instagram";
import { loadIg, updateIg, patchViral, type ViralComment, type ViralJob } from "./store";

const run = promisify(execFile);
const MODEL = process.env.NOVA_MODEL || "claude-opus-4-8";
const WS = path.join(process.cwd(), "workspace", "ig");
const ASSETS = path.join(process.cwd(), "assets", "ig");
const PY = process.env.NOVA_PYTHON || (process.platform === "win32" ? "python" : "python3");
const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
// yt-dlp görüntü+sesi birleştirmek için ffmpeg ister; PATH'te yoksa yerini açıkça ver
const FFMPEG_DIR =
  process.env.FFMPEG_DIR || (process.platform === "win32" ? "C:/Users/info/tools/ffmpeg/bin" : "");
const LINK =
  /https?:\/\/(?:www\.|m\.)?(?:instagram\.com\/(?:reel|reels|p)\/[\w-]+|youtube\.com\/shorts\/[\w-]+|youtu\.be\/[\w-]+|(?:vm\.|vt\.|www\.)?tiktok\.com\/\S+)\S*/i;
const HASHTAGS = "#komikyorumlar #mizah #komik #reels #keşfet #viral";

export const isViralMode = () => process.env.IG_MODE === "viral";

// ---------- yardımcılar ----------

async function job(id?: string): Promise<ViralJob | undefined> {
  const s = await loadIg();
  const want = id ?? s.viralActive;
  return (s.viral || []).find((j) => j.id === want);
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

function fullCaption(j: ViralJob): string {
  return `${j.aciklama || "En komik yorumlar burada 😂"}\n\n🎥 Kaynak: ${j.kaynak}\nVideonun sahibiyseniz ve kaldırılmasını istiyorsanız DM atın.\n\n${HASHTAGS} ${j.hashtag || ""}`.trim();
}

function listText(ys: ViralComment[]): string {
  return ys
    .map(
      (y, i) =>
        `${i + 1}) ${y.sayfa ? "[senin yorumun] " : ""}${y.metin}` +
        (y.orijinal && y.orijinal !== y.metin ? `\n   (aslı: ${y.orijinal})` : ""),
    )
    .join("\n");
}

// Yorumları okuyan ses (Yücel adıyla değiştirebilir). Varsayılan: VIRAL_VOICE_ID =
// "Viral Yorum Babacan" (2026-10-03, Yücel: "daha kalın, babacan"; çok kalın, sıcak, 50'lerinde adam).
const VOICES: Record<string, string> = {
  babacan: "TKEqaGmyBUcAtUiFeBzn",
  gulen: "zqmQVwjUCUbh80aSu9Ir",
  esref: "dREIsEMBQnt8e3KYj6Jz",
  bilgehan: "1CHZaHFxO6Rbh3tFQWXE",
  emre: "kP8ARB0FE9SWzM2p3Iep",
  veyzel: "qiYSibuYxMVcoiWBNsky",
  dilek: "ggNaO6NobK7mzVacuMYD",
  damla: "A2XgcJ6lQVEFeIaIUyrc",
  gozde: "rtnDjO8siSxeTEeTVczO",
  irem: "R0D8QjgVyRju4HRoCrIC",
};
const TR: Record<string, string> = { ş: "s", ı: "i", ç: "c", ğ: "g", ü: "u", ö: "o", "̇": "" };
const voiceKey = (t: string) =>
  t.toLocaleLowerCase("tr").replace(/^ses\s*:?\s*/, "").replace(/[şıçğüö̇]/g, (c) => TR[c] ?? c).trim();

const REVIEW_HELP =
  `👆 Videoya bunlar girecek.\n` +
  `• Aynen kullanmak için: "tamam"\n` +
  `• Değiştirmek için ne istediğini yaz: "2'yi çıkar", "3: yeni metin", "sona şunu ekle: …"`;

type Edit = { yorumlar: ViralComment[]; hazir: boolean }; // hazir: Yücel "paylaş/kur/hazırla" da dedi

async function applyEdits(current: ViralComment[], adaylar: ViralComment[], talimat: string): Promise<Edit> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Bir Reels'e konacak yorum listesini Yücel'in talimatına göre düzenle.

Şu anki liste (sırayla):
${JSON.stringify(current, null, 1)}

Videonun altındaki diğer gerçek yorumlar (gerekirse buradan seçilebilir):
${JSON.stringify(adaylar.slice(0, 40).map((a) => a.metin))}

Yücel'in talimatı: ${JSON.stringify(talimat)}

Önce mesajın ne olduğuna karar ver:
A) BOTA TALİMAT: listeden/numaralardan söz ediyor ya da "sadece, çıkar, sil, değiştir, ekle, sırala, paylaş, kur, hazırla, yap, kalsın, olsun, yorum(um)" gibi bota yönelik bir istek içeriyor (ör. "sadece 6 ile paylaş", "2'yi çıkar", "benim yorumum kalsın yeter"). Talimatın KENDİSİ asla listeye yorum olarak eklenmez.
B) YÜCEL'İN YORUMU: videoya dair bota hitap etmeyen bir espri/cümle (ör. "olmuş mu diye bakmak için tepesini açtığım mısır koçanı"). Bunu listenin SONUNA "sayfa": true ile AYNEN ekle (yalnız bariz yazım hatasını düzelt), diğer yorumların hepsini koru.
Emin değilsen A say ve listeyi değiştirme.

Kurallar:
- Talimatı aynen uygula; talimatın dışında hiçbir şeyi değiştirme, yorum uydurma. Açıkça istenmedikçe yorum silme.
- "Sadece X" → listede yalnız X kalır (numaralar şu anki listedeki sıradır, 1'den başlar).
- Yücel var olan bir yorumun metnini değiştirirse yeni metni aynen kullan; "orijinal" alanını koru.
- Diğer gerçek yorumlardan birini isterse onu (gerekirse aslına sadık Türkçeye çevirip) "orijinal" ile ekle.
- "hazir": mesaj videoyu hazırlamayı/paylaşmayı da istiyorsa ("paylaş", "kur", "hazırla", "yap", "bu kadar") true, değilse false.
SADECE JSON döndür: {"yorumlar":[{"metin":"…","orijinal":"…","begeni":"…","sayfa":false}],"hazir":false}`,
      },
    ],
  });
  const out = parseJson<Edit>(textOf(res));
  const yorumlar = (out.yorumlar || []).filter((y) => y?.metin);
  return { yorumlar: yorumlar.length ? yorumlar : current, hazir: !!out.hazir };
}

async function showReview(id: string, chat: number, head: string): Promise<void> {
  const j = (await job(id))!;
  await patchViral(id, { status: "review" });
  await tg.sendMessage(chat, `${head}\n\n${listText(j.yorumlar || [])}\n\n${REVIEW_HELP}`);
}

async function fail(id: string, chat: number, e: unknown) {
  const msg = (e as Error).message?.slice(0, 400) || String(e);
  await patchViral(id, { status: "failed", error: msg });
  await tg.sendMessage(chat, `⚠️ Olmadı: ${msg}\n\nAynı linki tekrar gönderebilirsin.`).catch(() => undefined);
}

// ---------- Claude: seçim ve ekran görüntüsü okuma ----------

type Selection = { yorumlar: ViralComment[]; yeterli: boolean; aciklama: string; hashtag: string };

async function selectComments(adaylar: ViralComment[], baslik: string): Promise<Selection> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Bir Instagram sayfası için "viral video + en komik yorumlar" Reels'i hazırlıyoruz. Videonun başlığı/açıklaması: ${JSON.stringify(baslik.slice(0, 300))}

Aşağıda videonun altındaki GERÇEK yorumlar var (beğeni sayısıyla). Kurallar:
- Yalnız bu listeden seç; asla yorum uydurma, birleştirme ya da espri ekleme.
- 4–6 yorum seç: kendi başına komik, kısa (ideal ≤ 110 karakter), videoyu görmeden de anlaşılır olsun.
- Türkçe değilse ASLINA SADIK çevir: anlamı aynen koru, yalnız Türkçede doğal dursun; kendinden kelime ekleme. Türkçeyse yalnız bariz yazım hatalarını düzelt.
- @etiketleri ve kullanıcı adlarını çıkar. Hakaret, ırkçılık, cinsel içerik, birini hedef alan/ifşa eden, reklam/kendi kanalını tanıtan, "2026'da izleyen var mı" gibi sıradan yorumları alma.
- En güçlü yorumu başa, ikinci en güçlüyü sona koy.
- "yeterli": en az 3 gerçekten komik yorum bulabildiysen true.
- "aciklama": Reels için 1 kısa, komik Türkçe cümle (kaynak ve hashtag'leri ben ekleyeceğim).
- "hashtag": konuya özel 1–2 Türkçe hashtag (ör. "#kedi #köpek").

Yorumlar:
${adaylar.map((a) => `- [${a.begeni ?? "?"}] ${a.metin.replace(/\n/g, " / ")}`).join("\n") || "(yok)"}

SADECE JSON döndür:
{"yorumlar":[{"metin":"Türkçe hâli","orijinal":"aslı","begeni":"beğeni sayısı"}],"yeterli":true,"aciklama":"…","hashtag":"#…"}`,
      },
    ],
  });
  const j = parseJson<Selection>(textOf(res));
  return {
    yorumlar: (j.yorumlar || []).filter((y) => y?.metin).slice(0, 6),
    yeterli: !!j.yeterli,
    aciklama: j.aciklama || "",
    hashtag: j.hashtag || "",
  };
}

async function readScreenshot(img: Buffer, mime: string): Promise<ViralComment[]> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: (["image/png", "image/webp", "image/gif"].includes(mime) ? mime : "image/jpeg") as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: img.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Bu bir Instagram/YouTube/TikTok yorum bölümünün ekran görüntüsü. Görünen HER yorumun metnini aynen (çevirmeden, düzeltmeden) ve görünüyorsa beğeni sayısını çıkar. Kullanıcı adlarını alma.
SADECE JSON: [{"metin":"…","begeni":"…"}]  (yorum yoksa [])`,
          },
        ],
      },
    ],
  });
  return parseJson<ViralComment[]>(textOf(res)).filter((c) => c?.metin);
}

// ---------- adımlar ----------

async function download(j: ViralJob): Promise<void> {
  await fs.mkdir(j.dir, { recursive: true });
  await run(
    YTDLP,
    [j.url, "--no-warnings", "--no-playlist", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4", "-o", path.join(j.dir, "kaynak.%(ext)s"), "--write-info-json", "--write-comments",
      ...(FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : [])],
    { timeout: 240_000, maxBuffer: 20 * 1024 * 1024 },
  );
  await fs.access(path.join(j.dir, "kaynak.mp4"));
}

async function readInfo(j: ViralJob): Promise<{ kaynak: string; baslik: string; adaylar: ViralComment[] }> {
  const info = JSON.parse(await fs.readFile(path.join(j.dir, "kaynak.info.json"), "utf8")) as {
    channel?: string; uploader_id?: string; uploader?: string; title?: string; description?: string;
    comments?: { text?: string; like_count?: number }[];
  };
  const isIg = /instagram\.com/i.test(j.url);
  const handle = isIg
    ? info.channel || info.uploader_id || info.uploader || "?"
    : (info.uploader_id?.startsWith("@") ? info.uploader_id.slice(1) : info.channel || info.uploader || "?");
  const adaylar = (info.comments || [])
    .filter((c) => c.text)
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    .slice(0, 80)
    .map((c) => ({ metin: c.text!.trim(), begeni: c.like_count ? String(c.like_count) : undefined }));
  return { kaynak: `@${handle}`, baslik: `${info.title || ""} ${info.description || ""}`.trim(), adaylar };
}

async function choose(id: string, chat: number, afterScreens = false): Promise<void> {
  const j = (await job(id))!;
  const sel = await selectComments(j.adaylar || [], j.baslik || "");
  await patchViral(id, { yorumlar: sel.yorumlar, aciklama: sel.aciklama, hashtag: sel.hashtag });
  if (!sel.yeterli && !afterScreens) {
    await patchViral(id, { status: "need_screens" });
    await tg.sendMessage(
      chat,
      `🔎 Instagram girişsiz yalnız ${j.adaylar?.length || 0} yorum gösterdi` +
        (sel.yorumlar.length ? `; bulabildiklerim:\n\n${listText(sel.yorumlar)}\n\n` : ", komik olan çıkmadı.\n\n") +
        `📸 Yorum bölümünün 1–2 ekran görüntüsünü gönderir misin? Bunlarla devam etmek istersen "devam" yaz.`,
    );
    return;
  }
  if (!sel.yorumlar.length) {
    await patchViral(id, { status: "need_screens" });
    await tg.sendMessage(chat, "📸 Kullanılabilir yorum bulamadım. Yorum bölümünün ekran görüntüsünü gönderir misin?");
    return;
  }
  await showReview(id, chat, `✅ Seçtiğim yorumlar (${j.kaynak}):`);
}

async function build(id: string, chat: number): Promise<void> {
  const j = (await job(id))!;
  await patchViral(id, { status: "building" });
  await tg.sendMessage(chat, "🎬 Video hazırlanıyor (yorumlar seslendiriliyor, ~1–2 dk)…");
  const likes = (b?: string) => (b && /\d/.test(b) ? b : ""); // bilinmeyen beğeni ("?") gösterilmez
  const yorumlar = (j.yorumlar || []).map((y) =>
    y.sayfa ? { metin: y.metin, sayfa: true } : { metin: y.metin, begeni: likes(y.begeni) },
  );
  const voice = (await loadIg()).viralVoice || process.env.VIRAL_VOICE_ID || VOICES.babacan;
  await fs.writeFile(
    path.join(j.dir, "is.json"),
    JSON.stringify({ video: "kaynak.mp4", kaynak: j.kaynak, baslik: "En komik yorumlar 😂", klip_sure: 4,
      ses_seviyesi: 0.15, ses_hizi: 1.08, ses_id: voice, yorumlar }, null, 1),
    "utf8",
  );
  await run(PY, [path.join(ASSETS, "yorumlu.py"), "is.json", "cikti.mp4"], {
    cwd: j.dir,
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const file = `${id}.mp4`;
  await fs.copyFile(path.join(j.dir, "cikti.mp4"), path.join(WS, file));
  const caption = fullCaption((await job(id))!);
  const msg = await tg.sendVideo(chat, path.join(WS, file), `👀 Önizleme\n\n${caption}`, [
    [{ text: "✅ Paylaş", callback_data: `vy_ok:${id}` }, { text: "❌ İptal", callback_data: `vy_no:${id}` }],
  ]);
  await patchViral(id, { status: "preview", file, previewMsgId: msg.message_id });
  await tg.sendMessage(chat, `Beğendiysen ✅ Paylaş'a bas. Yorumlarda değişiklik istersen yaz, videoyu yeniden hazırlarım.`);
}

async function startJob(chat: number, url: string): Promise<void> {
  const id = `vy-${Date.now().toString(36)}`;
  const j: ViralJob = { id, createdTs: Date.now(), url, dir: path.join(WS, "viral", id), status: "downloading" };
  await updateIg((s) => {
    s.viral = [...(s.viral || []), j];
    s.viralActive = id;
  });
  await tg.sendMessage(chat, "⏳ Linki aldım, video ve yorumlar indiriliyor…");
  try {
    await download(j);
    const { kaynak, baslik, adaylar } = await readInfo(j);
    await patchViral(id, { kaynak, adaylar, baslik });
    await choose(id, chat);
  } catch (e) {
    await fail(id, chat, new Error(`İndirilemedi ya da işlenemedi (özel hesap/giriş gerekiyor olabilir; videoyu dosya olarak da gönderebilirsin). ${(e as Error).message.slice(0, 200)}`));
  }
}

async function publish(id: string, chat: number, cbId: string): Promise<void> {
  const j = await job(id);
  if (!j || j.status !== "preview" || !j.file) {
    await tg.answerCallback(cbId, "Bu video zaten işlendi.");
    return;
  }
  await tg.answerCallback(cbId, "Paylaşılıyor…");
  await patchViral(id, { status: "publishing" });
  if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "⏳ Instagram'a yükleniyor…");
  try {
    const r = await publishReel(j.file, fullCaption(j));
    await patchViral(id, { status: "published", permalink: r.permalink });
    await updateIg((s) => void (s.viralActive = s.viralActive === id ? undefined : s.viralActive));
    if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, `✅ Paylaşıldı: ${r.permalink || ""}`);
    await tg.sendMessage(chat, `📤 Yayında: ${r.permalink || "(bağlantı alınamadı)"}\n\nYeni link gönderebilirsin.`);
  } catch (e) {
    await patchViral(id, { status: "preview", error: (e as Error).message.slice(0, 300) });
    await tg.sendMessage(chat, `⚠️ Paylaşılamadı: ${(e as Error).message}\nTekrar denemek için önizlemedeki ✅ Paylaş'a bas.`);
  }
}

// Bir işin videosunu mevcut listeyle yeniden kurar (bakım/onarım için).
export async function viralRebuild(id: string, chat: number): Promise<void> {
  await updateIg((s) => void (s.viralActive = id));
  await build(id, chat);
}

// Bir işi yorum onay adımına geri alır (bakım/onarım için).
export async function viralResume(id: string, chat: number, head: string): Promise<void> {
  await updateIg((s) => void (s.viralActive = id));
  await showReview(id, chat, head);
}

// ---------- giriş noktası ----------

export async function viralHandle(chat: number, u: tg.TgUpdate): Promise<void> {
  // Butonlar
  const q = u.callback_query;
  if (q?.data?.startsWith("vy_")) {
    const [act, id] = q.data.split(":");
    if (act === "vy_ok") void publish(id, chat, q.id);
    else if (act === "vy_no") {
      await patchViral(id, { status: "cancelled" });
      await updateIg((s) => void (s.viralActive = s.viralActive === id ? undefined : s.viralActive));
      await tg.answerCallback(q.id, "İptal edildi");
      const j = await job(id);
      if (j?.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "❌ İptal edildi");
    }
    return;
  }
  const m = u.message;
  if (!m) return;

  // Ekran görüntüsü (yorumlar)
  const photoId =
    m.document && (m.document.mime_type || "").startsWith("image/")
      ? m.document.file_id
      : m.photo?.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.file_id;
  if (photoId) {
    const j = await job();
    if (!j || !["need_screens", "review", "downloading"].includes(j.status)) {
      await tg.sendMessage(chat, "Önce bir Reels linki gönder, ekran görüntüsünü sonra at 🙏");
      return;
    }
    void (async () => {
      try {
        await tg.sendMessage(chat, "📸 Ekran görüntüsündeki yorumları okuyorum…");
        const mime = m.document?.mime_type || "image/jpeg";
        const found = await readScreenshot(await tg.downloadFile(photoId), mime);
        await updateIg((s) => {
          const x = (s.viral || []).find((v) => v.id === j.id);
          if (x) x.adaylar = [...found, ...(x.adaylar || [])];
        });
        await choose(j.id, chat, true);
      } catch (e) {
        await tg.sendMessage(chat, `⚠️ Ekran görüntüsü okunamadı: ${(e as Error).message.slice(0, 200)}`);
      }
    })();
    return;
  }

  const text = (m.text || m.caption || "").trim();
  const link = text.match(LINK)?.[0];
  if (link) {
    void startJob(chat, link);
    return;
  }
  // Ses değiştirme: "Damla", "ses: Gözde" …
  const vk = voiceKey(text);
  if (VOICES[vk] && text.length < 20) {
    await updateIg((s) => void (s.viralVoice = VOICES[vk]));
    await tg.sendMessage(chat, `🎙 Tamam, yorumları artık ${text.replace(/^ses\s*:?\s*/i, "")} okuyacak.`);
    return;
  }
  const j = await job();
  const ok = /^(tamam|aynen|ok|okey|olur|evet|devam|onay|kurabilirsin)\b/i.test(text);
  if (j?.status === "review") {
    if (ok) {
      void build(j.id, chat).catch((e) => fail(j.id, chat, e));
    } else {
      void (async () => {
        const { yorumlar: ys, hazir } = await applyEdits(j.yorumlar || [], j.adaylar || [], text);
        await patchViral(j.id, { yorumlar: ys });
        if (!hazir) return showReview(j.id, chat, "✏️ Güncel liste:");
        await tg.sendMessage(chat, `✏️ Son liste:\n\n${listText(ys)}`);
        await build(j.id, chat);
      })().catch((e) => fail(j.id, chat, e));
    }
    return;
  }
  if (j?.status === "need_screens" && /^devam/i.test(text)) {
    void choose(j.id, chat, true).catch((e) => fail(j.id, chat, e));
    return;
  }
  if (j?.status === "preview" && !ok) {
    // Önizlemeden sonra değişiklik: listeyi düzenle, videoyu yeniden kur
    if (j.previewMsgId) await tg.editCaption(chat, j.previewMsgId, "🔁 Değişiklik istendi, yenisi hazırlanıyor…");
    void (async () => {
      const { yorumlar: ys } = await applyEdits(j.yorumlar || [], j.adaylar || [], text);
      await patchViral(j.id, { yorumlar: ys });
      await tg.sendMessage(chat, `✏️ Yeni liste:\n\n${listText(ys)}`);
      await build(j.id, chat);
    })().catch((e) => fail(j.id, chat, e));
    return;
  }
  if (j && ["downloading", "building", "publishing"].includes(j.status)) {
    await tg.sendMessage(chat, "⏳ Hâlâ üzerinde çalışıyorum, birazdan haber veririm.");
    return;
  }
  await tg.sendMessage(
    chat,
    "🥺 Bana viral bir Reels linki gönder (Reels → Paylaş → Bağlantıyı kopyala).\n" +
      "1) En komik yorumları seçip gösteririm → \"tamam\" ya da değişikliğini yaz\n" +
      "2) Videoyu kurup önizleme gönderirim → ✅ Paylaş\n" +
      "🎙 Sesi değiştirmek için adını yaz — Gülen (varsayılan), Eşref, Bilgehan, Emre, Veyzel · kadın: Dilek, Damla, Gözde, İrem.",
  );
}
