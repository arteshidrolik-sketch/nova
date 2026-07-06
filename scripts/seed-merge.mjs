// Açılışta çalışır: seed/*.json içindeki EKSİK kayıtları data/*.json'a EKLER.
// Mevcut kayıtların üzerine YAZMAZ (kullanıcının/uygulamanın data'daki düzenlemeleri korunur).
// Yalnızca id'li nesne dizileri için id-bazlı birleştirme yapar (ör. skills.json).
// Böylece repoya yeni bir seed skill'i eklenince deploy'da otomatik canlıya düşer.
import { promises as fs } from "fs";
import path from "path";

const SEED = process.env.NOVA_SEED_DIR || "/app/seed";
const DATA = process.env.NOVA_DATA_DIR || "/app/data";

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

function isIdArray(v) {
  return Array.isArray(v) && v.every((x) => x && typeof x.id === "string");
}

async function main() {
  let seedFiles;
  try {
    seedFiles = await fs.readdir(SEED);
  } catch {
    return; // seed yoksa yapacak bir şey yok
  }
  await fs.mkdir(DATA, { recursive: true });

  for (const file of seedFiles) {
    if (!file.endsWith(".json")) continue;
    const seedData = await readJson(path.join(SEED, file));
    if (seedData == null) continue;

    const dataPath = path.join(DATA, file);
    const existing = await readJson(dataPath);

    // data'da hiç yoksa: seed'i olduğu gibi oluştur
    if (existing == null) {
      await fs.writeFile(dataPath, JSON.stringify(seedData, null, 2), "utf8");
      console.log(`[seed-merge] ${file}: oluşturuldu`);
      continue;
    }

    // id-bazlı birleştirme (yalnızca her iki taraf da id'li dizi ise)
    if (isIdArray(seedData) && isIdArray(existing)) {
      const ids = new Set(existing.map((x) => x.id));
      const toAdd = seedData.filter((x) => !ids.has(x.id));
      if (toAdd.length) {
        const merged = existing.concat(toAdd);
        await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), "utf8");
        console.log(
          `[seed-merge] ${file}: ${toAdd.length} yeni kayıt eklendi (${toAdd
            .map((x) => x.id)
            .join(", ")})`,
        );
      } else {
        console.log(`[seed-merge] ${file}: eksik kayıt yok`);
      }
    }
  }
}

main().catch((e) => console.error("[seed-merge] hata:", e?.message ?? e));
