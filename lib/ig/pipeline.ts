// Sanal Dilenci akışı:
//  08:00 → günlük konseptler → görsel → balon → Telegram'da ✅/❌
//  ❌ → yerine yeni konsept üretilip sunulur
//  onaylananlar kuyruğa girer → IG_SLOTS saatlerinde Instagram'a paylaşılır
import { promises as fs } from "fs";
import path from "path";
import { makeConcepts, checkImage } from "./claude";
import { generateRaw, prepare, addBubble, IG_DIR } from "./image";
import { publishImage, refreshTokenIfDue } from "./instagram";
import { FIXED_HASHTAGS, imagePrompt } from "./persona";
import { loadIg, updateIg, patchItem, type IgConcept, type IgItem } from "./store";
import * as tg from "./telegram";

const DAILY = Number(process.env.IG_DAILY || 10);
const STOCK_MAX = Number(process.env.IG_STOCK_MAX || 20); // onay bekleyen + kuyruk üst sınırı
const DAILY_AT = process.env.IG_DAILY_AT || "08:00";
const SLOTS = (process.env.IG_SLOTS || "10:00,12:30,15:00,18:00,21:00,23:30")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// İstanbul saati (konteyner UTC olabilir)
export function istanbulNow(d = new Date()): { date: string; hm: string; min: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const hm = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, hm, min: toMin(hm) };
}

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h % 24) * 60 + m;
}

export function igCaption(c: IgConcept): string {
  return `${c.aciklama}\n\n${FIXED_HASHTAGS} ${c.hashtag}`.trim();
}

async function ownerChat(): Promise<number | undefined> {
  const env = Number(process.env.TELEGRAM_CHAT_ID);
  if (env) return env;
  return (await loadIg()).chatId;
}

async function notify(text: string): Promise<void> {
  const chat = await ownerChat();
  if (chat) await tg.sendMessage(chat, text).catch(() => undefined);
}

function tgCaption(it: IgItem, label: string): string {
  const c = it.concept;
  return `${label} · ${c.klise}\n\n💬 ${c.balon.replace(/\n/g, " ")}\n\n📝 ${igCaption(c)}`;
}

function buttons(id: string): tg.Button[][] {
  return [[{ text: "✅ Onayla", callback_data: `ok:${id}` }, { text: "❌ Reddet", callback_data: `no:${id}` }]];
}

// Görsel kaynağı: "manual" (ücretsiz — Yücel Gemini uygulamasında üretip bota
// gönderir) ya da "auto" (Gemini API / fal.ai, ücretli).
const MANUAL = (process.env.IG_IMAGE_MODE || "manual") !== "auto";

async function chatOrThrow(): Promise<number> {
  const chat = await ownerChat();
  if (!chat) throw new Error("Telegram sohbeti yok — bota /start yaz");
  return chat;
}

// Ham görsel → kırp → kontrol → balon → Telegram'a ✅/❌ ile gönder.
async function finishImage(item: IgItem, raw: Buffer, label: string, strict: boolean): Promise<IgItem> {
  const base = await prepare(item.id, raw);
  const chk = await checkImage(await fs.readFile(base));
  if (!chk.ok && strict) {
    await fs.unlink(base).catch(() => {});
    throw new Error(`Görsel kontrolü geçmedi: ${chk.reason}`);
  }
  const file = await addBubble(item.id, base, item.concept.balon, chk.headX, chk.headY);
  await fs.unlink(base).catch(() => {});
  const warn = chk.ok ? "" : `\n\n⚠️ Kontrol notu: ${chk.reason}`;
  const done = { ...item, file, status: "pending" as const };
  const msg = await tg.sendPhoto(await chatOrThrow(), path.join(IG_DIR, file), tgCaption(done, label) + warn, buttons(item.id));
  return (await patchItem(item.id, { file, status: "pending", tgMessageId: msg.message_id, error: undefined }))!;
}

// Elle mod: konsept + hazır Gemini komutunu gönderir; fotoğraf bu mesaja yanıt olarak gelir.
async function requestPhoto(item: IgItem, label: string): Promise<IgItem> {
  const c = item.concept;
  const text =
    `${label} · <b>${tg.escapeHtml(c.klise)}</b>\n\n` +
    `💬 ${tg.escapeHtml(c.balon.replace(/\n/g, " "))}\n\n` +
    `👉 Gemini'de <b>karakter.jpg</b> ile aşağıdaki komutu üret, çıkan görseli <b>bu mesaja yanıt olarak</b> gönder:\n\n` +
    `<pre>${tg.escapeHtml(imagePrompt(c.sahne))}</pre>`;
  const msg = await tg.sendMessage(await chatOrThrow(), text, [[{ text: "⏭ Bu konsepti değiştir", callback_data: `skip:${item.id}` }]], true);
  return (await patchItem(item.id, { status: "awaiting_photo", promptMsgId: msg.message_id }))!;
}

// Tek konsept → (otomatik: görsel üret) / (elle: komut gönder).
async function produce(concept: IgConcept, batch: string, label: string): Promise<IgItem> {
  const id = `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const item: IgItem = { id, createdTs: Date.now(), batch, concept, status: MANUAL ? "awaiting_photo" : "generating" };
  await updateIg((s) => void s.items.push(item));
  try {
    if (MANUAL) return await requestPhoto(item, label);
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await finishImage(item, await generateRaw(concept.sahne), label, attempt < 2);
      } catch (e) {
        lastErr = e as Error;
        if (!lastErr.message.startsWith("Görsel kontrolü")) break; // sağlayıcı hatası → tekrar deneme
      }
    }
    throw lastErr;
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await patchItem(id, { status: "failed", error });
    await notify(`⚠️ Hazırlanamadı (${concept.klise}): ${error}`);
    throw e;
  }
}

// Elle mod: gelen fotoğrafı ilgili konseptle eşleştirip işler.
async function onPhoto(chatId: number, m: NonNullable<tg.TgUpdate["message"]>): Promise<void> {
  const fileId =
    m.document && (m.document.mime_type || "").startsWith("image/")
      ? m.document.file_id
      : m.photo?.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.file_id;
  if (!fileId) return;
  const s = await loadIg();
  const waiting = s.items.filter((i) => i.status === "awaiting_photo");
  const replyTo = m.reply_to_message?.message_id;
  const item = (replyTo && waiting.find((i) => i.promptMsgId === replyTo)) || (!replyTo ? waiting[0] : undefined);
  if (!item) {
    await tg.sendMessage(chatId, "🤔 Bu fotoğraf hangi konsept için? Lütfen ilgili komut mesajına YANIT olarak gönder.");
    return;
  }
  await patchItem(item.id, { status: "generating" });
  await tg.sendMessage(chatId, `🎨 Aldım (${item.concept.klise}) — balon ekleniyor…`);
  try {
    await finishImage(item, await tg.downloadFile(fileId), "🖼", false);
  } catch (e) {
    await patchItem(item.id, { status: "awaiting_photo" });
    await tg.sendMessage(chatId, `⚠️ İşlenemedi: ${(e as Error).message}\nAynı mesaja tekrar gönderebilirsin.`);
  }
}

let busy = false;

// n yeni gönderi üretip onaya sunar (sırayla; sağlayıcı kotasını zorlamasın).
export async function makeBatch(n: number, rejectedHint = false): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const s = await loadIg();
    const used = s.items.filter((i) => i.status !== "rejected").map((i) => i.concept.balon);
    const rejected = s.items.filter((i) => i.status === "rejected").map((i) => i.concept.balon);
    const concepts = await makeConcepts(n, used, rejectedHint ? rejected : rejected.slice(-10));
    const { date } = istanbulNow();
    if (MANUAL) {
      // Referans fotoğrafı en başta gönder → Gemini'ye buradan kolayca eklenir
      await tg
        .sendPhoto(await chatOrThrow(), path.join(process.cwd(), "assets", "ig", "karakter.jpg"),
          `📌 karakter.jpg — her komutta Gemini'ye bunu ekle.\nSıradaki ${concepts.length} mesajın her birine üretilen görseli YANIT olarak gönder.`)
        .catch(() => undefined);
    }
    let ok = 0;
    for (let i = 0; i < concepts.length; i++) {
      try {
        await produce(concepts[i], date, `🆕 ${i + 1}/${concepts.length}`);
        ok++;
      } catch {
        /* notify içeride yapıldı; sıradakiyle devam */
      }
    }
    return ok;
  } finally {
    busy = false;
  }
}

async function stock(): Promise<{ waiting: number; pending: number; approved: number }> {
  const s = await loadIg();
  return {
    waiting: s.items.filter((i) => i.status === "awaiting_photo").length,
    pending: s.items.filter((i) => i.status === "pending" || i.status === "generating").length,
    approved: s.items.filter((i) => i.status === "approved").length,
  };
}

// Reddedilen/değiştirilen konseptin yerine yenisi (poller'ı bekletmeden).
function replaceLater(): void {
  void (async () => {
    const s = await loadIg();
    const used = s.items.filter((i) => i.status !== "rejected").map((i) => i.concept.balon);
    const rejected = s.items.filter((i) => i.status === "rejected").map((i) => i.concept.balon);
    const [c] = await makeConcepts(1, used, rejected);
    if (c) await produce(c, istanbulNow().date, "🔁 Yenisi");
  })().catch(() => undefined);
}

// Günlük üretim: DAILY_AT'ten sonra günde bir kez.
async function dailyTick(): Promise<void> {
  const now = istanbulNow();
  if (now.min < toMin(DAILY_AT)) return;
  const s = await loadIg();
  if (s.lastBatchDate === now.date) return;
  await updateIg((st) => void (st.lastBatchDate = now.date));
  const st = await stock();
  const n = Math.min(DAILY, STOCK_MAX - st.waiting - st.pending - st.approved);
  if (n <= 0) {
    await notify(`📦 Stok dolu (${st.approved} kuyrukta, ${st.pending + st.waiting} bekliyor) — bugün yeni konsept yok.`);
    return;
  }
  await notify(
    MANUAL
      ? `☀️ Günaydın abim! Bugünün ${n} konsepti geliyor. Her birinin görselini Gemini'de üretip mesajına yanıt olarak at, gerisini ben hallederim 🙏`
      : `☀️ Günaydın! Bugünün ${n} görseli hazırlanıyor, birazdan onayına gelecek.`,
  );
  // Arka planda: üretim dakikalar sürer, paylaşım zamanlayıcısını bekletmesin
  void makeBatch(n)
    .then((ok) => (MANUAL ? undefined : notify(`✅ ${ok}/${n} görsel onayına sunuldu.`)))
    .catch((e) => notify(`⚠️ Günlük üretim hatası: ${(e as Error).message}`));
}

// Saat dilimi geldiyse kuyruğun en eskisini paylaş (dilim geçtiyse 45 dk tolerans).
async function publishTick(): Promise<void> {
  const now = istanbulNow();
  const s = await loadIg();
  const used = s.usedSlots?.[now.date] || [];
  const slot = SLOTS.find((x) => now.min >= toMin(x) && now.min - toMin(x) <= 45 && !used.includes(x));
  if (!slot) return;
  await updateIg((st) => {
    const today = st.usedSlots?.[now.date] || [];
    st.usedSlots = { [now.date]: [...today, slot] }; // yalnız bugünü tut
  });
  await publishNext(slot);
}

// Kuyruğun en eskisini hemen paylaşır (saat dilimi ya da /paylas).
async function publishNext(label: string): Promise<boolean> {
  const s = await loadIg();
  const next = s.items
    .filter((i) => i.status === "approved" && i.file)
    .sort((a, b) => (a.approvedTs || 0) - (b.approvedTs || 0))[0];
  if (!next) return false;
  try {
    const r = await publishImage(next.file!, igCaption(next.concept));
    await patchItem(next.id, { status: "published", publishedTs: Date.now(), igMediaId: r.id, permalink: r.permalink });
    const left = (await stock()).approved;
    await notify(`📤 Paylaşıldı (${label}): ${next.concept.klise}\n${r.permalink || ""}\nKuyrukta ${left} gönderi kaldı.`);
    return true;
  } catch (e) {
    await patchItem(next.id, { error: (e as Error).message.slice(0, 300) });
    await notify(`⚠️ Paylaşım hatası (${label}): ${(e as Error).message}\nGönderi kuyrukta kaldı, sonraki saatte tekrar denenecek.`);
    return false;
  }
}

async function onCallback(q: NonNullable<tg.TgUpdate["callback_query"]>): Promise<void> {
  const [act, id] = (q.data || "").split(":");
  const s = await loadIg();
  const it = s.items.find((i) => i.id === id);
  const chat = q.message?.chat.id;
  if (act === "skip" && it?.status === "awaiting_photo") {
    await patchItem(id, { status: "rejected" });
    await tg.answerCallback(q.id, "Değiştiriliyor…");
    if (chat && it.promptMsgId) await tg.editText(chat, it.promptMsgId, `⏭ Değiştirildi: ${it.concept.klise} — yenisi geliyor`);
    replaceLater();
    return;
  }
  if (!it || it.status !== "pending") {
    await tg.answerCallback(q.id, "Bu gönderi zaten işlendi.");
    return;
  }
  if (act === "ok") {
    await patchItem(id, { status: "approved", approvedTs: Date.now() });
    await tg.answerCallback(q.id, "Onaylandı ✅");
    const st = await stock();
    if (chat && it.tgMessageId)
      await tg.editCaption(chat, it.tgMessageId, tgCaption(it, `✅ ONAYLANDI (kuyrukta ${st.approved})`));
    if (st.pending === 0 && st.waiting === 0) await notify(`🎉 Bugünkülerin hepsi onaylandı. Kuyrukta ${st.approved} gönderi var; ${SLOTS.join(", ")} saatlerinde paylaşılacak.`);
  } else if (act === "no") {
    await patchItem(id, { status: "rejected" });
    await tg.answerCallback(q.id, "Reddedildi — yenisi hazırlanıyor");
    if (chat && it.tgMessageId) await tg.editCaption(chat, it.tgMessageId, tgCaption(it, "❌ REDDEDİLDİ — yenisi geliyor"));
    replaceLater();
  }
}

async function onMessage(chatId: number, text: string): Promise<void> {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  if (cmd === "/durum") {
    const s = await loadIg();
    const st = await stock();
    const today = istanbulNow().date;
    const pub = s.items.filter((i) => i.status === "published" && istanbulNow(new Date(i.publishedTs!)).date === today).length;
    await tg.sendMessage(chatId, `${MANUAL ? `🖼 Görsel bekleyen: ${st.waiting}\n` : ""}📊 Onay bekleyen: ${st.pending}\n📦 Kuyrukta: ${st.approved}\n📤 Bugün paylaşılan: ${pub}\n🕒 Saatler: ${SLOTS.join(", ")}\n☀️ Günlük üretim: ${DAILY_AT} (${DAILY} adet, stok sınırı ${STOCK_MAX})`);
  } else if (cmd === "/paylas") {
    if (!(await stock()).approved) return void (await tg.sendMessage(chatId, "📭 Kuyrukta onaylı gönderi yok."));
    await tg.sendMessage(chatId, "📤 Sıradaki gönderi şimdi paylaşılıyor…");
    await publishNext("elle");
  } else if (cmd === "/uret") {
    const n = Math.max(1, Math.min(10, Number(text.split(/\s+/)[1]) || 1));
    if (busy) return void (await tg.sendMessage(chatId, "⏳ Şu an üretim sürüyor, bitince tekrar dene."));
    await tg.sendMessage(chatId, `🎨 ${n} konsept hazırlanıyor…`);
    void makeBatch(n).catch(() => undefined);
  } else {
    await tg.sendMessage(
      chatId,
      `🥺 Sanal Dilenci onay botu\n\n/durum — kuyruk ve bekleyenler\n/uret 3 — şimdi 3 konsept üret\n/paylas — kuyruktaki sıradakini hemen paylaş\n\n` +
        (MANUAL ? `Her konsept mesajındaki komutu Gemini'de karakter.jpg ile üret, görseli o mesaja YANIT olarak at. ` : "") +
        `Balonlu görselin altındaki ✅/❌ ile onay/ret verirsin; ret edilenin yerine yenisi gelir.`,
    );
  }
}

async function handle(u: tg.TgUpdate): Promise<void> {
  const from = u.message?.from?.id ?? u.callback_query?.from.id;
  const chat = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (!chat) return;
  const owner = await ownerChat();
  if (!owner) {
    // İlk /start yazan sahip olur (TELEGRAM_CHAT_ID ile sabitlemek daha güvenli)
    if (u.message?.text?.startsWith("/start")) {
      await updateIg((s) => void (s.chatId = chat));
      await tg.sendMessage(chat, `✅ Kaydedildin (sohbet: ${chat}). Onaylar buraya gelecek.`);
    }
    return;
  }
  if (chat !== owner && from !== owner) return; // başkaları yok sayılır
  if (u.callback_query) await onCallback(u.callback_query);
  else if (u.message?.photo || u.message?.document) await onPhoto(chat, u.message);
  else if (u.message?.text) await onMessage(chat, u.message.text);
}

// Nova açılışında (IG_WORKER=on) başlar: Telegram yoklama + dakikalık zamanlayıcı.
export function startIgWorker(): void {
  const g = globalThis as unknown as { __igWorker?: boolean };
  if (g.__igWorker) return;
  g.__igWorker = true;

  void (async () => {
    for (;;) {
      try {
        const s = await loadIg();
        const ups = await tg.getUpdates(s.tgOffset);
        for (const u of ups) {
          await updateIg((st) => void (st.tgOffset = u.update_id + 1));
          await handle(u).catch(() => undefined);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  })();

  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await publishTick().catch(() => undefined);
      await dailyTick().catch(() => undefined);
      await refreshTokenIfDue().catch(() => undefined);
    } finally {
      ticking = false;
    }
  }, 60_000);
}
