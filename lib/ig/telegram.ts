// Telegram Bot API (bağımlılıksız, fetch). Onay botu: TELEGRAM_BOT_TOKEN.
import { promises as fs } from "fs";

function api(method: string): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN yok");
  return `https://api.telegram.org/bot${t}/${method}`;
}

type TgResp<T> = { ok: boolean; result?: T; description?: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as TgResp<T>;
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result as T;
}

export type Button = { text: string; callback_data: string };

export function sendMessage(chatId: number, text: string, buttons?: Button[][], html = false) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: "HTML" } : {}),
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function editText(chatId: number, messageId: number, text: string, html = false) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(html ? { parse_mode: "HTML" } : {}),
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

// Telegram'daki bir dosyayı indirir (fotoğraf/doküman).
export async function downloadFile(fileId: string): Promise<Buffer> {
  const f = await call<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`Telegram dosya indirilemedi: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function sendPhoto(chatId: number, file: string, caption: string, buttons?: Button[][]) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption.slice(0, 1024));
  if (buttons) form.append("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
  form.append("photo", new Blob([new Uint8Array(await fs.readFile(file))], { type: "image/jpeg" }), "gorsel.jpg");
  const res = await fetch(api("sendPhoto"), { method: "POST", body: form });
  const j = (await res.json()) as TgResp<{ message_id: number }>;
  if (!j.ok) throw new Error(`Telegram sendPhoto: ${j.description}`);
  return j.result!;
}

export function editCaption(chatId: number, messageId: number, caption: string) {
  return call("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption: caption.slice(0, 1024),
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

export function answerCallback(id: string, text: string) {
  return call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => undefined);
}

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number }[];
    document?: { file_id: string; mime_type?: string };
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

// Uzun yoklama (timeout saniye). Webhook gerekmez → Nova basic-auth arkasında kalabilir.
export async function getUpdates(offset: number | undefined, timeout = 25): Promise<TgUpdate[]> {
  const res = await fetch(api("getUpdates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout, allowed_updates: ["message", "callback_query"] }),
    signal: AbortSignal.timeout((timeout + 10) * 1000),
  });
  const j = (await res.json()) as TgResp<TgUpdate[]>;
  if (!j.ok) throw new Error(`Telegram getUpdates: ${j.description}`);
  return j.result || [];
}
