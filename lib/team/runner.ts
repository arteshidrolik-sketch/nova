// Uzman ajan çalıştırıcı: müdürün verdiği tek bir görevi, uzmanın kendi sistem
// istemi + becerileri + rolüne izinli araçlarla yürütür ve teslim metnini döner.
// Riskli aksiyonlar (push/deploy/issue) onay kuyruğuna düşer; diğerleri hemen
// çalışır (sohbetin dosya alanında). Uzman kullanıcıyla konuşmaz; müdüre teslim eder.
import Anthropic from "@anthropic-ai/sdk";
import {
  GENERAL_ACTION_TOOLS, PROJECT_ACTION_TOOLS, executeAction, actionRequiresApproval,
  actionTitle, actionSummary, actionDangerous, isProjectAction,
} from "@/lib/tools/actions";
import { READ_TOOLS, READ_TOOL_NAMES, runReadTool } from "@/lib/tools/projectFiles";
import { createTask } from "@/lib/tasks/store";
import { appendAudit } from "@/lib/audit/store";
import { recordUsage } from "@/lib/budget/store";
import { detectInjection, wrapUntrusted, UNTRUSTED_RULE } from "@/lib/security/untrusted";
import { getSkillsForTeamRole } from "@/lib/skills/store";
import { ensureTeamSkills } from "./skills";
import { TEAM_META, type TeamRole } from "./roles";

const ROLE_ACTIONS: Record<Exclude<TeamRole, "manager">, string[]> = {
  research: ["write_file", "generate_document"],
  coder: [
    "write_file", "generate_document", "edit_excel", "write_project_file", "edit_project_file",
    "publish_project_file", "run_command", "git_commit_push", "deploy_vercel", "github_create_issue",
  ],
  marketing: ["write_file", "generate_document", "generate_image", "edit_image", "restyle_image", "generate_video", "edit_video", "images_to_video"],
};

const ROLE_PROMPT: Record<Exclude<TeamRole, "manager">, string> = {
  research:
    "Sen bir ARAŞTIRMA UZMANISIN. Güncel bilgi için web_search kullan, birincil kaynakları öne al, iddiaları kaynak linkleriyle ver, güven düzeyini belirt. Uydurma yok; bulamadığını açıkça yaz.",
  coder:
    "Sen bir YAZILIM GELİŞTİRİCİSİN. Proje dosyalarını önce oku, küçük ve odaklı değişiklik yap, run_command ile derle/test et, hatayı düzelt. Doğrulamadığın şeyi 'çalışıyor' diye sunma.",
  marketing:
    "Sen bir SATIŞ VE PAZARLAMA UZMANISIN. Hedef kitleye uygun, Türk pazarına ve diline uygun, net faydalı, yanıltıcı olmayan metin/teklif üret; gerekiyorsa generate_image ile görsel üret.",
};

export type SpecialistRun = { text: string; artifacts: string[]; actions: number; input: number; output: number };

const MEDIA_TOOLS = new Set([
  "generate_image", "edit_image", "restyle_image", "generate_document", "write_file", "edit_excel", "publish_project_file",
  "generate_video", "edit_video", "images_to_video",
]);

export async function runSpecialist(opts: {
  client: Anthropic;
  model: string;
  effort?: "low" | "medium" | "high";
  role: Exclude<TeamRole, "manager">;
  task: string;
  criteria: string;
  revisionNote?: string;
  previous?: string; // önceki teslim (revizyonda)
  history?: string; // projenin son konuşmaları — mevcut projeler kaldığı yerden devam etsin
  uploads?: { images: string[]; videos: string[] }; // kullanıcının yüklediği dosyalar (proje klasöründe)
  project: { path: string; name: string } | null;
  scope: string; // sohbetin dosya alanı
  emit: (s: string) => void;
  canceled: () => boolean;
}): Promise<SpecialistRun> {
  const { client, model, role, project, scope, emit, canceled } = opts;
  await ensureTeamSkills();
  const meta = TEAM_META[role];
  const skills = await getSkillsForTeamRole(role);
  const allowed = new Set(ROLE_ACTIONS[role]);
  const actionTools = [...GENERAL_ACTION_TOOLS, ...PROJECT_ACTION_TOOLS].filter(
    (t) => allowed.has((t as { name: string }).name) && (project || !isProjectAction((t as { name: string }).name)),
  );
  // Haiku 4.5: yeni (dinamik filtreli) web araçlarını ve uyarlanabilir düşünmeyi desteklemez → eski sürümler
  const legacy = /haiku/.test(model);
  const tools = [
    { type: legacy ? "web_search_20250305" : "web_search_20260209", name: "web_search", max_uses: role === "coder" ? 3 : 6 },
    // kaynağı gerçekten açıp okuyabilsin (yalnız aramada çıkan linkler açılabilir)
    ...(role !== "coder" ? [{ type: legacy ? "web_fetch_20250910" : "web_fetch_20260209", name: "web_fetch", max_uses: 4 }] : []),
    ...(project ? READ_TOOLS : []),
    ...actionTools,
  ] as unknown as Anthropic.Tool[];

  const system =
    `${ROLE_PROMPT[role]}\n\nBir proje ekibinde çalışıyorsun. Görevi PROJE MÜDÜRÜ verdi; sonucu müdüre teslim edeceksin, kullanıcıyla konuşmuyorsun. ` +
    `Görevi TEK SEFERDE eksiksiz tamamla; soru sorup durma — belirsizlikte makul varsayım yap ve teslimde yaz. ` +
    `Teslim metni: (1) ne yaptın, (2) sonuç/çıktı (dosya/görsel linkleri dahil), (3) kabul kriterlerini nasıl karşıladığın, (4) varsayımlar ve kalan riskler. ` +
    `Araç sonuçlarını taklit etme; bir iş ancak aracı gerçekten çağırdıysan yapılmıştır.` +
    (project ? `\n\nProje: ${project.name} (yerel yol: ${project.path}).` : "") +
    (skills.length ? `\n\n## Becerilerin\n` + skills.map((s) => `### ${s.name}\n${s.content}`).join("\n\n") : "") +
    UNTRUSTED_RULE;

  const user =
    (opts.history ? `PROJENİN SON KONUŞMALARI (bağlam — projede daha önce yapılanlar ve kararlar; bunlarla tutarlı ilerle):
${opts.history}

---

` : "") +
    (opts.uploads && (opts.uploads.images.length || opts.uploads.videos.length)
      ? `KULLANICININ YÜKLEDİĞİ DOSYALAR (projenin klasöründe, araçlara bu adlarla ver; araçlar boş bırakılırsa bunları otomatik kullanır):\n` +
        [...opts.uploads.images.map((n) => `- ${n} (görsel)`), ...opts.uploads.videos.map((n) => `- ${n} (video)`)].join("\n") + "\n\n"
      : "") +
    `GÖREV:\n${opts.task}\n\nKABUL KRİTERLERİ:\n${opts.criteria || "(belirtilmedi — makul kalite)"}` +
    (opts.revisionNote ? `\n\nMÜDÜRÜN REVİZYON NOTU (önceki teslimin eksikleri — bunları düzelt):\n${opts.revisionNote}` : "") +
    (opts.previous ? `\n\nÖNCEKİ TESLİMİN:\n${opts.previous.slice(0, 6000)}` : "");

  const convo: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const artifacts: string[] = [];
  let actions = 0, finalText = "", searches = 0, tokIn = 0, tokOut = 0;

  for (let iter = 0; iter < 10; iter++) {
    if (canceled()) break;
    const params = {
      model, max_tokens: legacy ? 8000 : 16000, system, tools, messages: convo,
      cache_control: { type: "ephemeral" }, // tekrar eden sistem istemi/beceriler önbellekten (ucuz) okunur
      ...(legacy ? {} : { thinking: { type: "adaptive" }, output_config: { effort: opts.effort || "high" } }),
    } as unknown as Anthropic.MessageStreamParams;
    // arama/sayfa açma tavanı: dolunca araçsız son tur → eldekiyle teslim
    if (searches >= 10) (params as unknown as Record<string, unknown>).tool_choice = { type: "none" };
    const stream = client.messages.stream(params);
    for await (const ev of stream) {
      if (canceled()) { try { (stream as { abort?: () => void }).abort?.(); } catch { /* yoksay */ } break; }
      if (ev.type === "content_block_start" && (ev.content_block as { type?: string })?.type === "server_tool_use") {
        searches++;
        if (searches === 1) emit(`\n🌐 ${meta.name} web'de araştırıyor…\n`); // tek satır, gürültü yok
      }
    }
    if (canceled()) break;
    const final = await stream.finalMessage();
    if (final.usage) {
      recordUsage(model, final.usage.input_tokens ?? 0, final.usage.output_tokens ?? 0).catch(() => {});
      tokIn += final.usage.input_tokens ?? 0; tokOut += final.usage.output_tokens ?? 0;
    }
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
    if (text) finalText = text;
    const uses = final.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    // asistan mesajı (sondaki düşünme bloklarını at)
    const content = [...final.content];
    while (content.length && (content[content.length - 1].type === "thinking" || content[content.length - 1].type === "redacted_thinking")) content.pop();
    if (!uses.length) {
      if (final.stop_reason === "pause_turn" || final.stop_reason === "max_tokens") {
        if (content.length) convo.push({ role: "assistant", content });
        continue;
      }
      break;
    }
    convo.push({ role: "assistant", content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of uses) {
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (project && READ_TOOL_NAMES.has(b.name)) {
        const r = await runReadTool(b.name, input, project.path);
        if (detectInjection(r).length) emit(`\n🛡️ ${meta.name}: okunan içerikte talimat-taklidi algılandı — veri sayıldı.\n`);
        results.push({ type: "tool_result", tool_use_id: b.id, content: wrapUntrusted(`${b.name}`, r) });
        continue;
      }
      if (!allowed.has(b.name)) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: "Bu araç senin rolüne kapalı.", is_error: true });
        continue;
      }
      const payload: Record<string, unknown> = { ...input };
      if (isProjectAction(b.name)) {
        if (!project) { results.push({ type: "tool_result", tool_use_id: b.id, content: "Bu sohbete bağlı proje klasörü yok.", is_error: true }); continue; }
        payload.projectPath = project.path; payload.projectName = project.name;
      }
      // Yüklenen dosyaları ilgili araçlara otomatik ver (uzman adı yazmasa da)
      const up = opts.uploads;
      if (up) {
        if (b.name === "images_to_video" && !(Array.isArray(payload.images) && payload.images.length)) payload._uploaded_images = up.images;
        if ((b.name === "edit_image" || b.name === "restyle_image") && !payload.base_image && up.images[0]) payload.base_image = up.images[0];
        if (b.name === "edit_video" && !payload.source_video && up.videos[0]) payload.source_video = up.videos[0];
        if (b.name === "generate_video" && !payload.reference_image_url && up.images[0]) payload.reference_image_url = `/api/files?name=${encodeURIComponent(up.images[0])}`;
      }
      const title = actionTitle(b.name, payload);
      if (actionRequiresApproval(b.name)) {
        const t = await createTask({ agent: "general", actionType: b.name, title, summary: actionSummary(b.name, payload), payload, dangerous: actionDangerous(b.name), status: "proposed" });
        emit(`\n⏳ ${meta.name}: onay bekliyor — ${title} ("Görevler"de onayla)\n`);
        results.push({ type: "tool_result", tool_use_id: b.id, content: `Riskli aksiyon onay kuyruğuna alındı (görev ${t.id.slice(0, 8)}). Teslimde "onaya sunuldu" de, "yapıldı" deme.` });
        continue;
      }
      emit(`\n⚙️ ${meta.name}: ${title}\n`);
      let result: string, ok = true;
      try { result = await executeAction(b.name, payload, scope); }
      catch (e) { ok = false; result = `Hata: ${e instanceof Error ? e.message : "bilinmeyen"}`; }
      actions++;
      appendAudit({ agent: "general", model, action: b.name, tier: "auto", summary: `[${meta.name}] ${actionSummary(b.name, payload) || title}`, ok, result, project: project?.name }).catch(() => {});
      if (ok && MEDIA_TOOLS.has(b.name)) {
        artifacts.push(result);
        emit(`\n${result}\n`); // görsel/dosya linki kullanıcıya hemen görünsün
      }
      results.push({ type: "tool_result", tool_use_id: b.id, content: result.slice(0, 12000) });
    }
    convo.push({ role: "user", content: results });
  }
  return { text: finalText || "(uzman teslim metni üretemedi)", artifacts, actions, input: tokIn, output: tokOut };
}
