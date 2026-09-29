// Yerel deneme: botu bu bilgisayarda çalıştırır (VPS'te IG_WORKER kapalıyken!).
// npx tsx --env-file=.env.local scripts/ig-worker.ts [konsept_sayisi]
import { startIgWorker, makeBatch } from "@/lib/ig/pipeline";

startIgWorker();
const n = Number(process.argv[2] || 0);
if (n > 0) makeBatch(n).then((k) => console.log(`${k} konsept gönderildi`)).catch((e) => console.error("HATA:", e.message));
console.log("Sanal Dilenci worker yerelde çalışıyor (Ctrl+C ile dur).");
