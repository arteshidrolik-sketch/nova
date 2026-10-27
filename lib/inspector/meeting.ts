// İş sonu görüşmesi: Müfettiş koşumun durumunu müdüre söyler (sert, dobra),
// müdür (hafif model) cevap verir ve gerekiyorsa aksiyon alır — zayıf not
// ajanların okuduğu proje kimliğine (brief) işlenir. Böylece döngü kapanır:
// ölçüm → verdikt → müdür kararı → brief → bir sonraki işte ajan düzeltir.
import Anthropic from "@anthropic-ai/sdk";
import { TIERS, teamCast, TEAM_META, type TeamRole } from "@/lib/team/roles";
import { getBrief, setBrief } from "@/lib/team/brief";
import { appendMeeting, readVerdicts, type Meeting, type Verdict } from "./store";

const NOTES_HEAD = "## Müfettiş notları";
const roleName = (r: string) => TEAM_META[r as TeamRole]?.name ?? r;

// Müfettişin metrik bazlı (LLM'siz, anında) durum tespiti — ters ve dobra ton.
function sertText(vs: Verdict[]): string {
  const parts: string[] = [];
  for (const v of vs) {
    const dert: string[] = [];
    if (v.metrics.failed) dert.push("BOŞ teslim etti");
    if (v.dims.hiz < 50) dert.push(`${v.metrics.sec} sn sürünmüş`);
    if (v.metrics.errors > 0) dert.push(`${v.metrics.errors} araç hatası yapmış`);
    if (v.dims.verim < 60) dert.push("laf kalabalığıyla token yakmış");
    if (v.judged && v.verdikt) dert.push(`"${v.verdikt}"`);
    parts.push(dert.length
      ? `${v.person} (${roleName(v.role)}) ${v.total}/100 — ${dert.join(", ")}.`
      : `${v.person} (${roleName(v.role)}) ${v.total}/100 — temiz iş, ${v.metrics.sec} sn'de bitirmiş.`);
  }
  const avg = Math.round(vs.reduce((a, v) => a + v.total, 0) / vs.length);
  const giris = avg >= 85 ? "Bu seferlik şikayetim az." : avg >= 65 ? "Vasat bir koşumdu, not ettim." : "Bu koşum tam bir rezaletti.";
  return `${giris} ${parts.join(" ")}`;
}

// Sansürsüz modelin verdiktleri işlendiğinde: müfettiş kendi cümleleriyle konuşur.
function dobraText(vs: Verdict[]): string {
  return vs.map((v) => `${v.person} (${roleName(v.role)}) ${v.total}/100: ${v.verdikt ? `"${v.verdikt}"` : "verdikt yok"}`).join(" · ");
}

// Müdürün cevabı + aksiyon kararı (hafif model — ucuz, 1-2 cümle).
async function managerReply(managerName: string, report: string, vs: Verdict[]): Promise<{ cevap: string; aksiyon: string; briefNotu: string }> {
  const fallback = { cevap: "Raporu aldım, ekibi takip ediyorum.", aksiyon: "", briefNotu: "" };
  const table = vs.map((v) =>
    `- ${v.person} (${roleName(v.role)}): toplam ${v.total}/100 · hız ${v.dims.hiz} · teslim ${v.dims.teslim} · verim ${v.dims.verim} · disiplin ${v.dims.disiplin}${v.dims.ilgililik !== null ? ` · ilgililik ${v.dims.ilgililik}` : ""} (${v.metrics.sec} sn, çıktı ${v.metrics.output} token)`
  ).join("\n");
  const sys =
    `Sen ${managerName}, proje müdürüsün. Müfettiş az önce ekibinin OPERASYON performans raporunu yüzüne okudu. ` +
    "Ona 1-2 cümleyle DOĞAL cevap ver: haklıysa kabul et, abartıyorsa savun; kuru tutanak dili kullanma. " +
    "Puanlar zayıfsa SOMUT bir aksiyon kararı al (ör. 'bir dahaki işi Sonnet'e vereceğim', 'Elif'e kısa yazmasını söyleyeceğim'); " +
    "brief_notu alanına, ajanların her görevde okuduğu proje kimliğine eklenecek TEK SATIR talimat yaz (gerekmiyorsa boş bırak). " +
    'YALNIZCA şu JSON ile yanıt ver: {"cevap":"...","aksiyon":"...","brief_notu":"..."}';
  const user = `MÜFETTİŞ RAPORU:\n${report.slice(0, 1500)}\n\nÖLÇÜMLER:\n${table}`;
  try {
    const client = new Anthropic();
    const r = await client.messages.create({
      model: TIERS.hafif.model, max_tokens: 300, temperature: 0.4,
      system: sys, messages: [{ role: "user", content: user }],
    });
    const txt = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const p = JSON.parse(m[0]) as { cevap?: unknown; aksiyon?: unknown; brief_notu?: unknown };
    return {
      cevap: String(p.cevap || fallback.cevap).slice(0, 400),
      aksiyon: String(p.aksiyon || "").slice(0, 200),
      briefNotu: String(p.brief_notu || "").slice(0, 200),
    };
  } catch { return fallback; }
}

// Müdürün notunu proje kimliğine işle (en yeni üstte, en çok 5 not tutulur).
async function noteToBrief(projectId: string, note: string): Promise<void> {
  const cur = await getBrief(projectId);
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const line = `- ${day}: ${note}`;
  let next: string;
  if (cur.includes(NOTES_HEAD)) {
    const [before, restRaw = ""] = cur.split(NOTES_HEAD);
    const restParts = restRaw.split(/\n(?=## )/); // ilk parça bu bölümün gövdesi
    const body = restParts.shift() ?? "";
    const old = body.split("\n").filter((l) => l.trim().startsWith("- ")).slice(0, 4);
    const section = `${NOTES_HEAD}\n${[line, ...old].join("\n")}`;
    next = `${before.trimEnd()}\n\n${section}\n${restParts.length ? "\n" + restParts.join("\n") : ""}`;
  } else {
    next = `${cur.trimEnd()}\n\n${NOTES_HEAD}\n${line}\n`.trimStart();
  }
  await setBrief(projectId, next);
}

// Görüşmeyi yap ve kaydet. kind "sert": iş biter bitmez (metrikten);
// "dobra": sansürsüz model verdiktleri işlenince (processQueue sonrası).
export async function holdMeeting(projectId: string, vs: Verdict[], kind: Meeting["kind"]): Promise<Meeting | null> {
  if (!vs.length) return null;
  const mufettis = kind === "dobra" ? dobraText(vs) : sertText(vs);
  const mudurAdi = teamCast(projectId).manager.name;
  const r = await managerReply(mudurAdi, mufettis, vs);
  if (r.briefNotu) await noteToBrief(projectId, r.briefNotu).catch(() => {});
  const m: Meeting = {
    id: `${Date.now()}-${projectId.slice(0, 8)}-${kind}`, ts: Date.now(), projectId, kind,
    mufettis, mudurAdi, mudur: r.cevap,
    aksiyon: r.aksiyon || (r.briefNotu ? "Proje kimliğine not düşüldü" : undefined),
    briefNotu: r.briefNotu || undefined,
  };
  await appendMeeting(m);
  return m;
}

// İş sonu görüşmesi: bu koşumda (sinceTs sonrası) puanlanan ajanlarla.
export async function meetingForRun(projectId: string, sinceTs: number): Promise<Meeting | null> {
  const vs = (await readVerdicts()).filter((v) => v.projectId === projectId && v.ts >= sinceTs);
  return holdMeeting(projectId, vs, "sert");
}
