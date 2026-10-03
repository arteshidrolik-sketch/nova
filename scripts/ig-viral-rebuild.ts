// Bakım: bir viral işin videosunu mevcut listeyle yeniden kurar ve önizlemeyi gönderir.
// npx tsx --env-file=.env.local scripts/ig-viral-rebuild.ts <is-id> ["önce gönderilecek mesaj"]
import * as tg from "@/lib/ig/telegram";
import { viralRebuild } from "@/lib/ig/viral";

const [id, note] = process.argv.slice(2);
const chat = Number(process.env.TELEGRAM_CHAT_ID);
(async () => {
  if (note) await tg.sendMessage(chat, note);
  await viralRebuild(id, chat);
  console.log("tamam");
})().catch((e) => { console.error("HATA:", e.message); process.exit(1); });
