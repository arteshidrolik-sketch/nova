// Proje müdürü: kullanıcının muhatabı. İşi kendisi yapmaz; "ajana_gorev_ver"
// aracıyla uzmana verir, teslimi kabul kriterlerine göre denetler, yetersizse
// revizyon notuyla aynı uzmana geri verir (döngü), sonunda kullanıcıya sunar.
import type Anthropic from "@anthropic-ai/sdk";
import { getSkillsForTeamRole } from "@/lib/skills/store";
import { ensureTeamSkills } from "./skills";
import { runSpecialist } from "./runner";
import { appendTeamLog } from "./log";
import { istanbulNow } from "./report";
import { costOf } from "@/lib/budget/store";
import { briefBlock } from "./brief";
import { SPECIALISTS, TEAM_META, TIERS, isTier, teamCast, type TeamRole, type Tier } from "./roles";

export const ASSIGN_TOOL_NAME = "ajana_gorev_ver";
export const ASSIGN_TOOL = {
  name: ASSIGN_TOOL_NAME,
  description:
    "Ekipten bir uzmana görev ver ve teslimini al. research = web araştırması/rakip-pazar analizi/kaynaklı rapor; " +
    "coder = projenin kodu, betik, teknik iş, derleme/test; marketing = hedef kitle, reklam/sosyal medya metni, görsel, teklif/fiyat. " +
    "Teslimi denetle; kriterleri karşılamıyorsa AYNI uzmana revizyon_notu ile tekrar ver (önceki teslim otomatik eklenir).",
  input_schema: {
    type: "object",
    properties: {
      ajan: { type: "string", enum: SPECIALISTS, description: "research | coder | marketing" },
      gorev: { type: "string", description: "Uzmanın sohbet geçmişini görmediğini bilerek eksiksiz, bağlamlı görev tanımı" },
      kabul_kriterleri: { type: "string", description: "2-5 maddelik ölçülebilir kabul kriteri" },
      revizyon_notu: { type: "string", description: "Yalnız revizyonda: önceki teslimin neyi eksik/yanlış, tam olarak ne isteniyor" },
      seviye: {
        type: "string", enum: ["hafif", "standart", "agir"],
        description: "Maliyet/kalite seviyesi. hafif = ucuz hızlı model (basit, kısa, tek adımlı iş); standart = çoğu iş; agir = en güçlü ve en pahalı model (zor, uzun, kritik iş). En ucuz YETERLİ seviyeyi seç.",
      },
    },
    required: ["ajan", "gorev", "kabul_kriterleri", "seviye"],
  },
} as const;

export async function buildManagerSystem(project: { name: string; path: string } | null, title: string, projectId = ""): Promise<string> {
  await ensureTeamSkills();
  const skills = await getSkillsForTeamRole("manager");
  const cast = teamCast(projectId);
  const brief = await briefBlock(projectId);
  return (
    `Sen ${cast.manager.name}, "${title}" projesinin PROJE MÜDÜRÜSÜN. Kullanıcının tek muhatabısın. Ekibin: ` +
    SPECIALISTS.map((r) => `${cast[r].name} — ${TEAM_META[r].name} uzmanı (ajan=${r}): ${TEAM_META[r].desc}`).join("; ") + ". " +
    "Kullanıcıya ekibinden isimleriyle bahset (ör. 'Elif araştırdı').\n" +
    "Kullanıcıyla DOĞRUDAN konuşuyorsun: ona 'sen' diye hitap et. Proje kimliğinde adı geçen proje sahibi (ör. Yücel) KULLANICININ KENDİSİDİR; " +
    "ondan üçüncü kişi gibi söz etme ('Yücel'e ilet / Yücel'e sor' deme; 'sana iletiyorum', 'onayını bekliyorum' de).\n" +
    "GÖRSEL ve VİDEO işleri (görsel üretme/düzenleme, video üretme/düzenleme, resimlerden tanıtım/slayt videosu) MARKETING uzmanındadır — coder'a verme. " +
    "Kullanıcı resim yükleyip 'video yap/dönüştür' derse marketing'e ver: birden çok resimden video = images_to_video (kredisiz, hızlı); tek resmi yapay zekâyla canlandırmak = generate_video (kredi harcar, açıkça istenirse). " +
    "Kullanıcının yüklediği dosyalar uzmana OTOMATİK iletilir; 'dosyaya erişemiyoruz' deme.\n\n" +
    "## Maliyet: seviye seçimi (her görevde zorunlu)\n" +
    (["hafif", "standart", "agir"] as Tier[]).map((t) => `- ${t} (${TIERS[t].label}): ${TIERS[t].note}`).join("\n") +
    "\nVarsayılan standart. Basit işi agir'a VERME (pahalı); kritik/zor işi hafif'e verme. Revizyonda iş tekrar takılırsa seviye kendiliğinden bir kademe yükselir.\n\n" +
    "## Çalışma şeklin (kesin kurallar)\n" +
    "- İşi KENDİN YAPMA: araştırma, kod, metin, görsel, belge üretimi gerekiyorsa ajana_gorev_ver ile uygun uzmana ver. Sen planlar, dağıtır, denetler, sunarsın.\n" +
    "- Yalnız basit selamlaşma, netleştirme sorusu ya da ekip çıktısını özetleme gibi işlerde doğrudan cevap ver.\n" +
    "- İstek belirsizse ve yanlış yapma maliyeti yüksekse önce kullanıcıya 1-2 net soru sor; değilse makul varsayımla başla ve varsayımı belirt.\n" +
    "- Her görevde ölçülebilir kabul kriteri yaz. Teslimi kriterlere tek tek karşı denetle.\n" +
    "- BÜYÜK İŞİ BÖL: tek görevde çok uzun metin isteme (ör. 26 senaryo, 20 sayfalık rapor). En fazla ~5 senaryo / ~3.000 kelimelik parçalara böl; " +
    "her parçayı ayrı görev olarak sırayla ver, uzmandan sonucu dosyaya (write_file / generate_document) yazmasını iste. Tek dev görev çok uzun sürer, " +
    "çıktı sınırına takılır ve kesilirse hepsi boşa gider. Önceki parçaların başlıklarını sonraki göreve ekle ki tekrar olmasın.\n" +
    "- Teslim yetersizse aynı uzmana revizyon_notu ile geri ver (görev başına en fazla 3 revizyon). Bağımsız alt işleri farklı uzmanlara verebilirsin.\n" +
    "- Kullanıcıya son cevapta: ne yapıldı, hangi uzman, kaç denetim turu, çıktılar (linkler aynen), kalan riskler. Kısa ve net ol.\n" +
    "- Uzmanın yaptığını kendin yapmış gibi anlatma; araç sonuçlarını taklit etme. Dosya/görsel linklerini teslimden AYNEN aktar, link uydurma.\n" +
    "- Metninde ✅ ⏳ ⚙️ ⚠️ 🌐 👥 👔 işaretlerini KULLANMA (sunucuya ayrılmış, görünmez olur); onay için ✓ kullan.\n" +
    "- SENDE KOMUT ÇALIŞTIRMA / API ÇAĞIRMA ARACI YOK. Token, dosya, build, yayın, git durumu gibi GÜNCEL bir şeyi kontrol etmek gerekiyorsa " +
    "MUTLAKA coder'a görev ver (hafif seviye yeter) ve onun teslimine göre konuş. 'Çalıştır: …', 'Yapıldı', komut çıktısı gibi satırları ASLA " +
    "kendin yazma. Sohbet geçmişindeki eski komut çıktıları ESKİDİR (o andan sonra token/dosya değişmiş olabilir); onları güncel sonuç gibi sunma. " +
    "Kullanıcı 'yükledim/yeniledim/düzelttim' derse önce coder'a doğrulat.\n" +
    (project ? `\nBu sohbet "${project.name}" proje klasörüne bağlı (${project.path}); kodu denetlemek için okuma araçlarını (list_files/read_file/search_files) kullanabilirsin.\n` : "") +
    (skills.length ? "\n## Becerilerin\n" + skills.map((s) => `### ${s.name}\n${s.content}`).join("\n\n") : "") +
    brief
  );
}

// Bir istek (run) boyunca müdürün görevlendirme durumu
export type AssignState = { total: number; perRole: Record<string, number>; last: Record<string, string> };
export function newAssignState(): AssignState {
  return { total: 0, perRole: {}, last: {} };
}

export async function handleAssign(
  input: Record<string, unknown>,
  ctx: {
    client: Anthropic; model: string; state: AssignState;
    project: { path: string; name: string } | null; scope: string;
    emit: (s: string) => void; canceled: () => boolean;
    history?: string; // projenin son konuşmaları (devamlılık için uzmana verilir)
    projectId?: string;
    uploads?: { images: string[]; videos: string[] };
  },
): Promise<{ content: string; isError?: boolean }> {
  const role = String(input.ajan || "") as TeamRole;
  if (!SPECIALISTS.includes(role as (typeof SPECIALISTS)[number])) {
    return { content: `Geçersiz ajan: ${role}. research | coder | marketing kullan.`, isError: true };
  }
  const r = role as (typeof SPECIALISTS)[number];
  const st = ctx.state;
  if (st.total >= 8) {
    return { content: "Bu istekte görevlendirme sınırına (8) ulaşıldı. Elindeki teslimlerle kullanıcıya sonucu ve kalan eksikleri sun.", isError: true };
  }
  const n = (st.perRole[r] ?? 0) + 1;
  const isRevision = !!String(input.revizyon_notu || "").trim() && !!st.last[r];
  if (isRevision && n > 4) {
    return { content: `${TEAM_META[r].name} için revizyon sınırı (3) doldu. En iyi teslimi kalan eksiklerle birlikte kullanıcıya sun.`, isError: true };
  }
  st.total++; st.perRole[r] = n;
  const meta = TEAM_META[r];
  const person = teamCast(ctx.projectId || "")[r].name;
  // Seviye: müdürün seçimi; revizyonda iş takılıyorsa (2. revizyondan itibaren) bir kademe yükselt
  const order: Tier[] = ["hafif", "standart", "agir"];
  const chosen: Tier = isTier(input.seviye) ? input.seviye : "standart";
  let tier: Tier = chosen;
  if (isRevision && n - 1 >= 2 && tier !== "agir") tier = order[order.indexOf(tier) + 1];
  const T = TIERS[tier];
  const task = String(input.gorev || "").trim();
  const head = task.split("\n")[0].slice(0, 110);
  ctx.emit(
    isRevision
      ? `\n\n👔 Müdür revizyon istedi → ${person} (${meta.name}): ${String(input.revizyon_notu).split("\n")[0].slice(0, 120)}\n👥 ${meta.name} çalışıyor [${T.label}] (revizyon ${n - 1}): ${head}\n`
      : `\n\n👥 ${meta.name} çalışıyor [${T.label}]: ${person} — ${head}\n`,
  );
  const t0 = Date.now();
  const res = await runSpecialist({
    client: ctx.client, model: T.model, effort: T.effort, role: r, task, projectId: ctx.projectId,
    criteria: String(input.kabul_kriterleri || ""),
    revisionNote: isRevision ? String(input.revizyon_notu) : undefined,
    history: ctx.history,
    uploads: ctx.uploads,
    previous: isRevision ? st.last[r] : undefined,
    project: ctx.project, scope: ctx.scope, emit: ctx.emit, canceled: ctx.canceled,
  });
  st.last[r] = res.text;
  const sec = Math.round((Date.now() - t0) / 1000);
  appendTeamLog({
    ts: Date.now(), day: istanbulNow().day, projectId: ctx.projectId || "", role: r, person,
    chosen, tier, model: T.model, revision: isRevision ? n - 1 : 0, task: head, sec,
    input: res.input, output: res.output, costUsd: Math.round(costOf(T.model, res.input, res.output) * 10000) / 10000,
    actions: res.actions, artifacts: res.artifacts.length,
    errors: res.errors.length ? res.errors : undefined, failed: res.failed || undefined,
    note: isRevision ? String(input.revizyon_notu).replace(/\s+/g, " ").trim().slice(0, 240) : undefined,
  }).catch(() => {});
  ctx.emit(`\n👥 ${meta.name} teslim etti (${person}, ${T.label}, ${sec} sn) — 👔 Müdür denetliyor…\n`);
  return {
    content:
      `[${person} — ${meta.name} teslimi, seviye ${tier}${isRevision ? ` — revizyon ${n - 1}` : ""}]\n${res.text.slice(0, 14000)}` +
      (res.artifacts.length ? `\n\n[Üretilen çıktılar — kullanıcıya bu linkleri AYNEN aktar]\n${res.artifacts.join("\n")}` : "") +
      `\n\n[Müdüre not] Bu teslimi kabul kriterlerine tek tek karşı denetle. Eksik/yanlış varsa aynı ajana revizyon_notu ile tekrar ver; ` +
      `uygunsa kullanıcıya sun. Revizyon hakkı kalan: ${Math.max(0, 3 - (n - 1))}.`,
  };
}
