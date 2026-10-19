// Türkçeleştirmeyi Telegram'sız dener: bir iş klasöründeki kaynak.mp4'ü çözümler ve
// çıkan Türkçe altyazıyı ekrana basar. Videoyu kurmak için --kur ekle.
//   npx tsx --env-file=.env.local scripts/ig-turkce-dene.ts <klasor> [--kur]
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { cozumle } from "@/lib/ig/turkce";

const run = promisify(execFile);

async function main() {
  const dir = path.resolve(process.argv[2] || "");
  const kur = process.argv.includes("--kur");
  await fs.access(path.join(dir, "kaynak.mp4"));

  const c = await cozumle(dir);
  console.log(`süre: ${c.sure} sn · dil: ${c.dil} · uygun: ${c.uygun}${c.neden ? ` (${c.neden})` : ""}`);
  console.log(`bant: ${c.bant ? `y=${c.bant.y} h=${c.bant.h}, ${c.kapat.length} aralık` : "yok"}`);
  console.log(`açıklama: ${c.aciklama}\n          ${c.aciklamaEn || "-"}\nhashtag: ${c.hashtag}\n`);
  for (const [i, l] of c.altyazi.entries()) {
    console.log(`${String(i + 1).padStart(2)}) [${l.bas.toFixed(2)}-${l.bit.toFixed(2)}] ${l.metin}`);
    if (l.en) console.log(`    EN:   ${l.en}`);
    if (l.asli) console.log(`    aslı: ${l.asli}`);
  }
  if (!kur) return;

  await fs.writeFile(
    path.join(dir, "is.json"),
    JSON.stringify({ video: "kaynak.mp4", bant: c.bant, kapat: c.kapat,
      altyazi: c.altyazi.map((l) => ({ bas: l.bas, bit: l.bit, metin: l.metin, en: l.en || "" })) }, null, 1),
    "utf8",
  );
  const out = await run(
    process.env.NOVA_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    [path.join(process.cwd(), "assets", "ig", "turkcelestir.py"), "kur", "is.json", "cikti.mp4"],
    { cwd: dir, timeout: 900_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
  );
  console.log("\n" + out.stdout.toString().trim());
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
