// Proje müdürü: kullanıcının muhatabı. İşi kendisi yapmaz; "ajana_gorev_ver"
// aracıyla uzmana verir, teslimi kabul kriterlerine göre denetler, yetersizse
// revizyon notuyla aynı uzmana geri verir (döngü), sonunda kullanıcıya sunar.
import type Anthropic from "@anthropic-ai/sdk";
import { getSkillsForTeamRole } from "@/lib/skills/store";
import { ensureTeamSkills } from "./skills";
import { runSpecialist } from "./runner";
import { SPECIALISTS, TEAM_META, type TeamRole } from "./roles";

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
    },
    required: ["ajan", "gorev", "kabul_kriterleri"],
  },
} as const;

export async function buildManagerSystem(project: { name: string; path: string } | null, title: string): Promise<string> {
  await ensureTeamSkills();
  const skills = await getSkillsForTeamRole("manager");
  return (
    `Sen "${title}" projesinin PROJE MÜDÜRÜSÜN. Kullanıcının tek muhatabısın. Ekibin: ` +
    SPECIALISTS.map((r) => `${TEAM_META[r].name} (${r}) — ${TEAM_META[r].desc}`).join("; ") + ".\n\n" +
    "## Çalışma şeklin (kesin kurallar)\n" +
    "- İşi KENDİN YAPMA: araştırma, kod, metin, görsel, belge üretimi gerekiyorsa ajana_gorev_ver ile uygun uzmana ver. Sen planlar, dağıtır, denetler, sunarsın.\n" +
    "- Yalnız basit selamlaşma, netleştirme sorusu ya da ekip çıktısını özetleme gibi işlerde doğrudan cevap ver.\n" +
    "- İstek belirsizse ve yanlış yapma maliyeti yüksekse önce kullanıcıya 1-2 net soru sor; değilse makul varsayımla başla ve varsayımı belirt.\n" +
    "- Her görevde ölçülebilir kabul kriteri yaz. Teslimi kriterlere tek tek karşı denetle.\n" +
    "- Teslim yetersizse aynı uzmana revizyon_notu ile geri ver (görev başına en fazla 3 revizyon). Bağımsız alt işleri farklı uzmanlara verebilirsin.\n" +
    "- Kullanıcıya son cevapta: ne yapıldı, hangi uzman, kaç denetim turu, çıktılar (linkler aynen), kalan riskler. Kısa ve net ol.\n" +
    "- Uzmanın yaptığını kendin yapmış gibi anlatma; araç sonuçlarını taklit etme. Dosya/görsel linklerini teslimden AYNEN aktar, link uydurma.\n" +
    (project ? `\nBu sohbet "${project.name}" proje klasörüne bağlı (${project.path}); kodu denetlemek için okuma araçlarını (list_files/read_file/search_files) kullanabilirsin.\n` : "") +
    (skills.length ? "\n## Becerilerin\n" + skills.map((s) => `### ${s.name}\n${s.content}`).join("\n\n") : "")
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
  const task = String(input.gorev || "").trim();
  const head = task.split("\n")[0].slice(0, 110);
  ctx.emit(
    isRevision
      ? `\n\n👔 Müdür revizyon istedi → ${meta.name}: ${String(input.revizyon_notu).split("\n")[0].slice(0, 120)}\n👥 ${meta.name} çalışıyor (revizyon ${n - 1}): ${head}\n`
      : `\n\n👥 ${meta.name} çalışıyor: ${head}\n`,
  );
  const t0 = Date.now();
  const res = await runSpecialist({
    client: ctx.client, model: ctx.model, role: r, task,
    criteria: String(input.kabul_kriterleri || ""),
    revisionNote: isRevision ? String(input.revizyon_notu) : undefined,
    history: ctx.history,
    previous: isRevision ? st.last[r] : undefined,
    project: ctx.project, scope: ctx.scope, emit: ctx.emit, canceled: ctx.canceled,
  });
  st.last[r] = res.text;
  ctx.emit(`\n👥 ${meta.name} teslim etti (${Math.round((Date.now() - t0) / 1000)} sn) — 👔 Müdür denetliyor…\n`);
  return {
    content:
      `[${meta.name} teslimi${isRevision ? ` — revizyon ${n - 1}` : ""}]\n${res.text.slice(0, 14000)}` +
      (res.artifacts.length ? `\n\n[Üretilen çıktılar — kullanıcıya bu linkleri AYNEN aktar]\n${res.artifacts.join("\n")}` : "") +
      `\n\n[Müdüre not] Bu teslimi kabul kriterlerine tek tek karşı denetle. Eksik/yanlış varsa aynı ajana revizyon_notu ile tekrar ver; ` +
      `uygunsa kullanıcıya sun. Revizyon hakkı kalan: ${Math.max(0, 3 - (n - 1))}.`,
  };
}
