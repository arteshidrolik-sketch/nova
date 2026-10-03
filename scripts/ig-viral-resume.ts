// Bakım: bir viral işi yorum onay adımına geri alır.
// npx tsx --env-file=.env.local scripts/ig-viral-resume.ts <is-id> ["başlık"]
import { patchViral } from "@/lib/ig/store";
import { viralResume } from "@/lib/ig/viral";

const [id, head] = process.argv.slice(2);
(async () => {
  await patchViral(id, { sayfaYorum: undefined, status: "review" });
  await viralResume(id, Number(process.env.TELEGRAM_CHAT_ID), head || "🔁 Listeyi yeniden gösteriyorum:");
  console.log("tamam");
})().catch((e) => { console.error("HATA:", e.message); process.exit(1); });
