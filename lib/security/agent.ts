// Güvenlik ajanı: Yücel'in KENDİ varlıklarına yetkili sızma testi. Pod'daki
// sansürsüz Qwen "beyin"dir; JSON aksiyon protokolüyle araç seçer, Nova araçları
// (kapsam-kilitli) pod'da çalıştırır, çıktıyı geri verir, döngü sürer. Her adım
// canlı akar; sonunda bulgular rapora yazılır. Kapsam kilidi tools.ts'tedir —
// ajan listede olmayan hiçbir hedefe dokunamaz.
import { promises as fs } from "fs";
import path from "path";
import { ollamaChatOnce } from "@/lib/brain/ollama";
import { getScope, checkTarget, extractHost, type Scope } from "./scope";
import { runSecTool, toolCatalog, type SecLevel } from "./tools";

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = process.env.NOVA_SECURITY_MODEL || process.env.NOVA_INSPECTOR_MODEL || "huihui_ai/qwen2.5-coder-abliterate:32b";
const REPORTS = path.join(process.cwd(), "data", "security", "reports");

type OllamaMsg = { role: "system" | "user" | "assistant"; content: string };
type Finding = { baslik: string; onem: string; kanit: string; cozum: string };

function systemPrompt(target: string, level: SecLevel, host: string): string {
  const tools = toolCatalog(level).map((t) => `- ${t.name} [${t.level}]: ${t.desc}`).join("\n");
  return (
    `Sen Nova'nın SIZMA TESTİ AJANISIN (red team). Yücel'in KENDİ sistemine, AÇIK YETKİSİYLE, ` +
    `güvenlik açığı bulmak için saldırıyorsun. Hedef: ${target}\n` +
    `Mod: ${level === "saldiri" ? "SALDIRI (sömürü/ele geçirme serbest)" : "KEŞİF (zararsız tespit)"}\n` +
    `⚠️ YALNIZCA bu hedefe saldır: ${host} (ve onun alt alan adları). BAŞKA hiçbir host'a dokunma — ` +
    `başka adres denersen reddedilir. Tek bir ürüne odaklan, başka sistem tarama.\n\n` +
    `AMACIN: açıkları SİSTEMATİK bul, mümkünse sömürüp etkisini KANITLA (ele geçirme, veri erişimi, yetki atlama), raporla. ` +
    `OWASP yöntemiyle çalış: keşif → saldırı yüzeyi → her sınıf (yetki/IDOR, enjeksiyon, kimlik doğrulama, SSRF, yanlış yapılandırma, sızıntı) → PoC.\n\n` +
    `KULLANABİLECEĞİN ARAÇLAR:\n${tools}\n\n` +
    `HER ADIMDA yalnızca TEK bir JSON döndür, başka hiçbir şey yazma. Üç biçimden biri:\n` +
    `1) Araç çalıştır: {"dusunce":"neden","arac":"<ad>","args":{...}}\n` +
    `2) Bulgu kaydet: {"bulgu":{"baslik":"...","onem":"kritik|yuksek|orta|dusuk|bilgi","kanit":"somut kanıt/istek-yanıt","cozum":"nasıl düzeltilir"}}\n` +
    `3) Bitir: {"bitti":true,"ozet":"genel değerlendirme"}\n\n` +
    `Kurallar: Önce recon yap. Bulduğun her ipucunu (açık dizin, parametre, panel) bir sonraki adımda derinleştir. ` +
    `Gerçek bir açık doğruladığında HEMEN bulgu kaydet. Araç çıktısı seni yanıltırsa http aracıyla elle doğrula. ` +
    `Kapsam dışı hedef verme — reddedilir. İş bitince (ya da ~${level === "saldiri" ? 24 : 16} adımda) bitir.`
  );
}

// Modelin yanıtından ilk JSON nesnesini ayıkla (bazen ``` veya düşünce metni sarar)
function parseAction(txt: string): Record<string, unknown> | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* bozuk */ }
  // iç içe/fazla metin → ilk dengeli { } bloğunu bul
  const s = txt.indexOf("{");
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < txt.length; i++) {
    if (txt[i] === "{") depth++;
    else if (txt[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(txt.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}

const ONEM_SIRA: Record<string, number> = { kritik: 0, yuksek: 1, orta: 2, dusuk: 3, bilgi: 4 };

export type RunOpts = { target: string; level: SecLevel; emit: (s: string) => void; canceled?: () => boolean };

export async function runSecurityAgent(opts: RunOpts): Promise<{ findings: Finding[]; reportPath: string }> {
  const { target, level, emit } = opts;
  const globalScope = await getScope();
  const host = extractHost(target);
  const maxSteps = level === "saldiri" ? 24 : 16;
  const findings: Finding[] = [];

  // Hedef, izinli mi? (kilit açıkken listede olmalı; kapalıyken serbest)
  const gchk = await checkTarget(target, globalScope);
  if (!gchk.ok) { emit(`⛔ ${gchk.reason}\n`); return { findings: [], reportPath: "" }; }

  // BU KOŞUM yalnız girilen hedefe (ve alt alan adlarına) kilitli — liste taranmaz.
  // Global allowlist sadece "neye izin var"ı belirler; koşum tek ürüne odaklanır.
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const runScope: Scope = { hosts: isIp ? [] : [host], ips: isIp ? [host] : [], enforce: true };

  emit(`🎯 Hedef: ${target}  ·  Mod: ${level === "saldiri" ? "⚔️ SALDIRI" : "🔍 KEŞİF"}\nYalnız bu hedef taranır: ${host} (+ alt alan adları)\n\n`);

  const messages: OllamaMsg[] = [
    { role: "system", content: systemPrompt(target, level, host) },
    { role: "user", content: `Hedefe (${target}) sızma testine başla. İlk adımın ne?` },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    if (opts.canceled?.()) { emit("\n⏹ Durduruldu.\n"); break; }
    let raw: string;
    try {
      raw = await ollamaChatOnce(OLLAMA, MODEL, messages, { temperature: 0.4, timeoutMs: 180000 });
    } catch (e) {
      emit(`\n⚠️ Model hatası: ${e instanceof Error ? e.message : "bilinmeyen"}\n`);
      break;
    }
    const action = parseAction(raw);
    messages.push({ role: "assistant", content: raw.slice(0, 4000) });
    if (!action) {
      messages.push({ role: "user", content: "Geçersiz yanıt. YALNIZCA tek bir JSON aksiyon döndür." });
      continue;
    }

    if (action.bitti) {
      emit(`\n✅ Ajan bitirdi: ${String(action.ozet || "").slice(0, 600)}\n`);
      break;
    }

    if (action.bulgu && typeof action.bulgu === "object") {
      const b = action.bulgu as Partial<Finding>;
      const f: Finding = {
        baslik: String(b.baslik || "?").slice(0, 160),
        onem: String(b.onem || "bilgi").toLowerCase(),
        kanit: String(b.kanit || "").slice(0, 2000),
        cozum: String(b.cozum || "").slice(0, 800),
      };
      findings.push(f);
      const icon = f.onem === "kritik" ? "🟥" : f.onem === "yuksek" ? "🟧" : f.onem === "orta" ? "🟨" : "🟦";
      emit(`\n${icon} BULGU [${f.onem}] ${f.baslik}\n   ${f.kanit.split("\n")[0].slice(0, 200)}\n`);
      messages.push({ role: "user", content: `Bulgu kaydedildi. Devam et — başka açık ara ya da bu açığı derinleştir (ele geçirmeye çalış).` });
      continue;
    }

    const toolName = String(action.arac || "");
    const args = (action.args && typeof action.args === "object" ? action.args : {}) as Record<string, string>;
    if (!toolName) {
      messages.push({ role: "user", content: "Aksiyonda 'arac' yok. Tekrar dene." });
      continue;
    }
    emit(`\n[${step}/${maxSteps}] 🔧 ${toolName}  ${JSON.stringify(args).slice(0, 180)}\n   ↳ ${String(action.dusunce || "").slice(0, 160)}\n`);
    const res = await runSecTool(toolName, args, level, runScope);
    const obs = res.output.slice(0, 6000);
    emit(`   ${res.blocked ? "⛔" : res.ok ? "✓" : "⚠"} ${obs.split("\n").slice(0, 8).join("\n   ").slice(0, 600)}${obs.length > 600 ? " …" : ""}\n`);
    messages.push({ role: "user", content: `ARAÇ ÇIKTISI (${toolName}):\n${obs}\n\nSıradaki adımın? (JSON)` });
  }

  // Rapor yaz
  findings.sort((a, b) => (ONEM_SIRA[a.onem] ?? 9) - (ONEM_SIRA[b.onem] ?? 9));
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(REPORTS, `${stamp}-${host.replace(/[^a-z0-9.-]/gi, "_")}.md`);
  const md = buildReport(target, level, findings, now);
  await fs.mkdir(REPORTS, { recursive: true });
  await fs.writeFile(reportPath, md, "utf8");
  emit(`\n\n📄 Rapor yazıldı: ${findings.length} bulgu → ${path.basename(reportPath)}\n`);
  return { findings, reportPath };
}

function buildReport(target: string, level: SecLevel, findings: Finding[], now: Date): string {
  const by = (o: string) => findings.filter((f) => f.onem === o);
  const counts = ["kritik", "yuksek", "orta", "dusuk", "bilgi"].map((o) => `${o}: ${by(o).length}`).join(" · ");
  let md = `# Güvenlik Raporu — ${target}\n\n`;
  md += `- Tarih: ${now.toLocaleString("tr-TR")}\n- Mod: ${level}\n- Toplam bulgu: ${findings.length} (${counts})\n\n`;
  md += `> Yetkili sızma testi — hedef Yücel'in kendi varlığıdır.\n\n`;
  if (!findings.length) { md += `Bu koşumda doğrulanmış bulgu yok.\n`; return md; }
  md += `## Bulgular\n\n`;
  findings.forEach((f, i) => {
    md += `### ${i + 1}. [${f.onem.toUpperCase()}] ${f.baslik}\n\n`;
    md += `**Kanıt:**\n\n\`\`\`\n${f.kanit}\n\`\`\`\n\n`;
    md += `**Çözüm:** ${f.cozum}\n\n`;
  });
  return md;
}
