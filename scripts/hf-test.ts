// Higgsfield video entegrasyonu uçtan uca testi (en ucuz model). Çalıştır: npx tsx scripts/hf-test.ts
import { promises as fs } from "fs";
import { executeAction } from "../lib/tools/actions";
async function main() {
  const img = await fs.readFile("public/avatar/nova.jpg");
  const t0 = Date.now();
  const r = await executeAction("generate_video", {
    prompt: "The woman slowly smiles and blinks, gentle camera push-in, soft green light",
    reference_image_url: `data:image/jpeg;base64,${img.toString("base64")}`,
    aspect: "portrait",
  }, "c-hftest00");
  console.log("SONUÇ:", r, "| süre:", Math.round((Date.now() - t0) / 1000), "sn");
}
main().catch((e) => { console.error("HATA", e); process.exit(1); });
