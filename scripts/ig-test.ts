// Yerel deneme: npx tsx --env-file=.env.local scripts/ig-test.ts [konsept|gorsel]
import { promises as fs } from "fs";
import path from "path";
import { makeConcepts, checkImage } from "@/lib/ig/claude";
import { generateRaw, prepare, addBubble } from "@/lib/ig/image";

async function main() {
  const mode = process.argv[2] || "konsept";
  const concepts = await makeConcepts(mode === "konsept" ? 3 : 1, []);
  console.log(JSON.stringify(concepts, null, 2));
  if (mode !== "gorsel") return;
  const c = concepts[0];
  const id = `test-${Date.now().toString(36)}`;
  const base = await prepare(id, await generateRaw(c.sahne));
  const chk = await checkImage(await fs.readFile(base));
  console.log("kontrol:", chk);
  const file = await addBubble(id, base, c.balon, chk.headX, chk.headY);
  console.log("hazır:", path.join("workspace", "ig", file));
}
main().catch((e) => { console.error("HATA:", e.message); process.exit(1); });
