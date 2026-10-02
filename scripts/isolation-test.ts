// Sohbet yalıtımı testi: iki sohbet aynı adla dosya yazar → birbirini ezmemeli;
// hafıza notları yalnız kendi sohbetinde görünmeli. Çalıştır: npx tsx scripts/isolation-test.ts
import { promises as fs } from "fs";
import path from "path";
import { executeAction, workspaceScopeFor, workspaceReadPath } from "../lib/tools/actions";
import { saveMemory, searchMemories, loadMemories } from "../lib/memory/store";

async function main() {
  const A = "aaaaaaaa-1111-4111-8111-111111111111", B = "bbbbbbbb-2222-4222-8222-222222222222";
  const sA = workspaceScopeFor(A), sB = workspaceScopeFor(B);
  let fail = 0;
  const ok = (name: string, cond: boolean, extra = "") => { console.log(cond ? "OK  " : "FAIL", name, extra); if (!cond) fail++; };

  // --- dosyalar ---
  const rA = await executeAction("write_file", { path: "rapor.txt", content: "A sohbeti" }, sA);
  const rB = await executeAction("write_file", { path: "rapor.txt", content: "B sohbeti" }, sB);
  const tA = await fs.readFile(workspaceReadPath(sA, "rapor.txt"), "utf8");
  const tB = await fs.readFile(workspaceReadPath(sB, "rapor.txt"), "utf8");
  ok("aynı adlı dosya ezilmedi", tA === "A sohbeti" && tB === "B sohbeti", `A="${tA}" B="${tB}"`);
  ok("bağlantı sohbet klasörünü içeriyor", rA.includes(encodeURIComponent(`${sA}/rapor.txt`)) && rB.includes(encodeURIComponent(`${sB}/rapor.txt`)));
  // kapsamsız (eski davranış) ortak klasöre yazar
  await executeAction("write_file", { path: "isolation-legacy.txt", content: "ortak" });
  ok("eski ortak dosya sohbetten okunabiliyor (geriye uyum)", (await fs.readFile(workspaceReadPath(sA, "isolation-legacy.txt"), "utf8")) === "ortak");
  // kapsam dışına çıkış engeli
  let escaped = false;
  try { await executeAction("write_file", { path: "../../kacis.txt", content: "x" }, sA); escaped = true; } catch { /* beklenen */ }
  ok("yol kaçışı engellendi", !escaped);

  // --- hafıza ---
  const before = (await loadMemories()).length;
  const mA = await saveMemory({ summary: "isolationtest zebra tercih A sohbetine ait", tags: ["isolationtest"], scope: A });
  const mB = await saveMemory({ summary: "isolationtest zebra tercih B sohbetine ait", tags: ["isolationtest"], scope: B });
  const mL = await saveMemory({ summary: "isolationtest zebra eski ortak not", tags: ["isolationtest"] });
  const gA = await searchMemories("isolationtest zebra tercih", 5, A);
  const gB = await searchMemories("isolationtest zebra tercih", 5, B);
  ok("A yalnız kendi notunu görüyor", gA.length === 1 && gA[0].id === mA.id, `(${gA.length})`);
  ok("B yalnız kendi notunu görüyor", gB.length === 1 && gB[0].id === mB.id, `(${gB.length})`);
  ok("eski ortak not hiçbir sohbete sızmıyor", ![...gA, ...gB].some((m) => m.id === mL.id));

  // temizlik
  const ids = new Set([mA.id, mB.id, mL.id]);
  const rest = (await loadMemories()).filter((m) => !ids.has(m.id));
  await fs.writeFile(path.join(process.cwd(), "data", "memories.json"), JSON.stringify(rest, null, 2), "utf8");
  ok("hafıza temizlendi", rest.length === before);
  for (const s of [sA, sB]) await fs.rm(path.join(process.cwd(), "workspace", s), { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), "workspace", "isolation-legacy.txt"), { force: true });
  console.log(fail ? `\n${fail} TEST BAŞARISIZ` : "\nTÜM TESTLER GEÇTİ");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("HATA", e); process.exit(1); });
