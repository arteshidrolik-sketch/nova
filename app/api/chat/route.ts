import Anthropic from "@anthropic-ai/sdk";
import { selectAgent } from "@/lib/agents/orchestrator";
import { SYSTEM_PROMPTS } from "@/lib/agents/prompts";
import { modelForAgent } from "@/lib/agents/models";
import { searchMemories } from "@/lib/memory/store";
import { GITHUB_TOOL, runGithubLookup } from "@/lib/tools/github";
import {
  GENERAL_ACTION_TOOLS,
  PROJECT_ACTION_TOOLS,
  actionDangerous,
  actionRequiresApproval,
  actionTitle,
  actionSummary,
  executeAction,
  isActionTool,
  isProjectAction,
} from "@/lib/tools/actions";
import {
  READ_TOOLS,
  READ_TOOL_NAMES,
  runReadTool,
} from "@/lib/tools/projectFiles";
import { createTask } from "@/lib/tasks/store";
import {
  appendRun,
  cancelRun,
  createRun,
  finishRun,
  getRun,
  isCanceled,
} from "@/lib/runs/store";
import {
  getActiveId,
  getProjectByConversation,
  setActive,
} from "@/lib/projects/store";
import { getSkillsForAgent } from "@/lib/skills/store";
import { getConversation, updateConversation } from "@/lib/conversations/store";
import { isAgentKey } from "@/lib/agents/meta";
import { getCustomAgent, type CustomAgent } from "@/lib/agents/custom";
import { getSkillsByIds } from "@/lib/skills/store";
import { logToVault } from "@/lib/vault/journal";
import { getControl, isStopped } from "@/lib/control/store";
import { getBudget, isOverCap, recordUsage } from "@/lib/budget/store";
import {
  wrapUntrusted,
  detectInjection,
  UNTRUSTED_RULE,
} from "@/lib/security/untrusted";
import { appendAudit } from "@/lib/audit/store";

export const runtime = "nodejs";

// Router: hızlı ve ucuz model yeterli (sadece ajan seçer)
const ROUTER_MODEL = process.env.NOVA_ROUTER_MODEL || "claude-fable-5";

// Asistan mesajı bir `thinking` bloğuyla BİTEMEZ (API 400). Sondaki düşünme
// bloklarını at (öncekiler tool_use imzası için korunur).
function trimTrailingThinking(
  content: Anthropic.ContentBlock[],
): Anthropic.ContentBlock[] {
  const arr = [...content];
  while (
    arr.length > 0 &&
    (arr[arr.length - 1].type === "thinking" ||
      arr[arr.length - 1].type === "redacted_thinking")
  ) {
    arr.pop();
  }
  return arr;
}
const MAX_TOOL_ITERATIONS = 12;

type Attach = {
  kind: "image" | "pdf" | "text";
  name?: string;
  mediaType?: string;
  data?: string; // base64
  text?: string;
};
type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attach[];
};

// Modele gönderilen geçmişi sınırla (uzun sohbetlerde bağlam şişip yavaşlamasın).
// Sondan başa doğru karakter bütçesi dolana kadar mesaj tut; ilk mesaj user olsun.
function trimHistory(
  msgs: IncomingMessage[],
  maxChars = 40000,
): IncomingMessage[] {
  const kept: IncomingMessage[] = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const len =
      (typeof m.content === "string" ? m.content.length : 0) +
      (m.attachments?.length ? 4000 : 0);
    if (total + len > maxChars && kept.length > 0) break;
    kept.unshift(m);
    total += len;
  }
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept.length ? kept : msgs.slice(-1);
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "ANTHROPIC_API_KEY tanımlı değil. .env.local dosyana ekle ve sunucuyu yeniden başlat.",
      { status: 500 },
    );
  }

  let messages: IncomingMessage[];
  let conversationId = ""; // proje bağlamını sohbete göre çöz
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
    conversationId =
      typeof body?.conversationId === "string" ? body.conversationId : "";
  } catch {
    return new Response("Geçersiz istek gövdesi.", { status: 400 });
  }
  // Boş içerikli mesajları at: eski/yarım kayıtlar (content:"") API'yi 400'e
  // düşürüp sohbeti kalıcı kilitliyordu. Bu, kilitlenmiş sohbeti de iyileştirir.
  messages = messages.filter(
    (m) =>
      (typeof m.content === "string" && m.content.trim().length > 0) ||
      (Array.isArray(m.attachments) && m.attachments.length > 0),
  );
  if (messages.length === 0) {
    return new Response("Mesaj bulunamadı.", { status: 400 });
  }

  const client = new Anthropic();

  // Kill switch + bütçe durumunu belleğe yükle
  await getControl();
  await getBudget();

  // Sohbete kilitli ajan var mı? (ör. "Araştırma" sohbeti → research ajanı)
  // Kilitli sohbet PROJEDEN BAĞIMSIZDIR: orkestratör ve proje bağlamı atlanır.
  const conv = conversationId ? await getConversation(conversationId) : null;
  const forcedRaw = conv?.forcedAgent || null;
  const forcedAgent = forcedRaw && isAgentKey(forcedRaw) ? forcedRaw : null;
  // Yerleşik değilse özel ajan mı? (kullanıcının oluşturduğu, data/agents.json)
  const customAgent: CustomAgent | null =
    forcedRaw && !forcedAgent ? (await getCustomAgent(forcedRaw)) ?? null : null;
  const locked = !!forcedAgent || !!customAgent;

  // Proje bağlamı — bulunduğun SOHBETE bağlı proje (kilitli sohbette yok)
  const project = locked
    ? null
    : conversationId
      ? await getProjectByConversation(conversationId)
      : null;
  // UI tutarlılığı için global aktifi de senkronla
  if (project && (await getActiveId()) !== project.id) {
    await setActive(project.id);
  }

  // Önceki yanıtın ajanı — kısa devam mesajlarında sürekliliği korumak için
  let prevAgent: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      const a = (messages[i] as { agent?: unknown }).agent;
      if (typeof a === "string") prevAgent = a;
      break;
    }
  }

  // 1) Ajan seçimi: özel ajan → o; kilitli yerleşik → o; beyin → developer; değilse orkestratör
  const agent = forcedAgent
    ? forcedAgent
    : customAgent
      ? "general" // yerleşik-anahtar gerektiren yerler için güvenli varsayılan
      : project?.self
        ? "developer"
        : await selectAgent(client, ROUTER_MODEL, messages, prevAgent);
  let answerModel = customAgent
    ? customAgent.model
    : project?.self
      ? "claude-opus-4-8"
      : modelForAgent(agent);
  // Büyük dosya yazımı kesilmesin diye güçlü modellerde daha yüksek çıktı limiti
  let maxTokens = /opus|sonnet/.test(answerModel) ? 16000 : 8000;
  let escalated = false; // refusal olursa bir kez daha güçlü modele yükselt

  // 2) Hafıza — sona ayrı eklenir; güvenlik reddi (refusal) olursa hafızasız tekrar denenir
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const relevant = await searchMemories(lastUser, 3);
  const memNote =
    relevant.length > 0
      ? "\n\n## İlgili geçmiş notlar (hafıza)\nBunları gerektiğinde kullan, gereksizse görmezden gel:\n" +
        relevant.map((m) => `- ${m.summary}`).join("\n")
      : "";
  // Özel ajanın kendi sistem promptu; yoksa yerleşik ajanınki
  let system = customAgent
    ? `Sen "${customAgent.name}" adlı bir asistansın.\n\n${customAgent.systemPrompt}`
    : SYSTEM_PROMPTS[agent];

  if (project) {
    system +=
      `\n\n## Aktif proje: ${project.name}\nYerel yol: ${project.path}\n` +
      `Bu proje üzerinde çalışıyorsun. Bir şey söylemeden ÖNCE dosyaları incele: ` +
      `önce list_files ile yapıyı gör, search_files ile ilgili yeri bul, read_file ile oku. ` +
      `Tahmin etme. Değişiklik gerekiyorsa write_project_file (yeni/tam dosya) veya ` +
      `edit_project_file (metin değişikliği) çağır — araçlar GO beklemeden ANINDA çalışır.`;

    system +=
      `\n\n### ⚡ İki kademe: GÜVENLİ (otomatik) vs RİSKLİ (onaylı)\n` +
      `GÜVENLİ aksiyonlar — write_project_file, edit_project_file, run_command, generate_document, write_file — ` +
      `çağırınca HEMEN çalışır ve sonuç GERÇEKTİR ("✅ DİSKE YAZILDI: … N bayt" = dosya diskte, KESİN). ` +
      `Bunlar için "onay bekliyor / yazma izni yok" DEME.\n` +
      `RİSKLİ aksiyonlar — git_commit_push (push), github_create_issue — İNSAN ONAYI ister: çağırınca Görevler onay ` +
      `kuyruğuna düşer, kullanıcı onaylayınca çalışır. Bunları çağırdığında "yaptım/push ettim" DEME; "onayına sundum, ` +
      `Görevler'de onayla" de. Kod değişikliklerini yaz (otomatik iner) ama push'u kullanıcı onayına bırak.\n` +
      `### 🚫 HALÜSİNASYON YASAK — araç sonucuna GÜVEN\n` +
      `Bir araç "yazıldı/yapıldı" diyorsa iş OLMUŞTUR; bu yer gerçeğidir. ASLA şunları UYDURMA: "diske yansımıyor", ` +
      `"kuyruk ile dosya sistemi arasında kopukluk", "sistem arızalı", "izin sorunu", "setup.sh çalıştır", ` +
      `"hâlâ kökte sadece PROMPT.md var". Bunlar YANLIŞ ve kullanıcıyı yorar. ` +
      `Emin değilsen SPEKÜLE ETME → list_files/read_file ÇAĞIR ve GÖR. ` +
      `ÖNEMLİ: önceki list_files sonucun ESKİMİŞTİR (o zamandan beri dosya yazdın). Doğrulamak için list_files'ı YENİDEN çağır; ` +
      `eski sonuca bakıp "dosya yok" deme. Kullanıcıya elle script/komut çalıştırmasını önerme — sen zaten yapabiliyorsun, YAP.\n` +
      `### 📁 Doğru yolu KEŞFET (tahmin etme)\n` +
      `Bir read_file "bulunamadı" derse YOL YANLIŞTIR. Proje kökünde backend/, frontend/, app/, src/ gibi ` +
      `bir alt klasör olabilir ve asıl kaynak ORADA olabilir (ör. NestJS kökü backend/ altında). ` +
      `Önce list_files ile GERÇEK yapıyı gör, sonra dosya yollarını o köke göre ver. Aynı yanlış yolu tekrar deneme.`;

    if (project.self) {
      system +=
        `\n\n## 🧠 BU SENİN KENDİ KAYNAK KODUN (Nova) — KIDEMLİ YAZILIM MÜHENDİSİ GİBİ ÇALIŞ\n` +
        `"${project.path}" senin çalışan uygulamanın kaynağı. Burada araçların GO BEKLEMEDEN OTOMATİK çalışır ` +
        `(write_project_file, edit_project_file, run_command, git_commit_push) — özgürce, adım adım iterasyon yap. İzin isteme, YAP.\n\n` +
        `### Çalışma yöntemi (harfiyen uy — ben böyle çalışıyorum):\n` +
        `1. **OKU:** Değiştireceğin dosyaları önce list_files/search_files/read_file ile TAM oku. Asla tahmin etme.\n` +
        `2. **KÜÇÜK DEĞİŞTİR:** edit_project_file ile küçük, kesin düzenlemeler yap (old_str dosyada BİREBİR geçmeli). Yeni dosyada write_project_file (içeriğin TAMAMINI ver, boş bırakma).\n` +
        `3. **DOĞRULA:** Her değişiklikten sonra MUTLAKA \`run_command\` ile \`npm run build\` çalıştır. Derleme hatası çıkarsa hata mesajını oku → ilgili dosyayı düzelt → tekrar build. HATASIZ olana kadar bu döngüyü sürdür.\n` +
        `4. **COMMIT:** build GEÇTİKTEN SONRA git_commit_push ile commit'le (anlamlı mesajla). Commit güvenli otomatik-deploy'u tetikler; sağlıksızsa sistem bir önceki sürüme döner.\n` +
        `5. **ÖZETLE:** Kullanıcıya ne yaptığını 1-2 cümleyle söyle.\n\n` +
        `### Katı kurallar:\n` +
        `- Niyet anlatma, ARACI ÇAĞIR. "build alıyorum / düzeltiyorum / okuyorum" deyip durma — aracı FİİLEN çağır.\n` +
        `- HIZLI ve VERİMLİ ol: search_files ile yeri bul, SADECE gereken 1-3 dosyayı oku, sonra HEMEN düzenlemeye geç. Aşırı keşif/okuma yapma, aynı yeri tekrar tekrar arama.\n` +
        `- Görevi TEK TURDA bitir: oku → düzenle → build → (gerekirse düzelt) → commit. Ortada 'ilerleme raporu' verip DURMA; iş bitene ya da gerçekten tıkanana kadar araç çağırmaya devam et.\n` +
        `- Build GEÇMEDEN ASLA commit etme. Bozuk kod commit'lersen ekran gelmez.\n` +
        `- Değişiklikleri küçük ve odaklı tut; ana görseli/çalışan akışı bozma.\n\n` +
        `### Mimari harita (nerede ne var):\n` +
        `- app/api/chat/route.ts → sohbet orkestrasyonu (ajan seçimi, araçlar, akış döngüsü)\n` +
        `- lib/agents/ → orchestrator.ts (yönlendirme), prompts.ts (sistem promptları), models.ts (ajan→model), meta.ts (ajan tanımları)\n` +
        `- lib/tools/ → actions.ts (aksiyonlar: write/edit/run_command/git), projectFiles.ts (okuma araçları)\n` +
        `- components/ → AppShell (kabuk), Sidebar (alt menü barı), Workspace (harita+sohbet), Chat (sohbet+ses), AgentMap (uzay/ajan haritası), Dashboard (yan pano), Projects\n` +
        `- lib/projects/store.ts, lib/conversations/store.ts, data/*.json (yerel JSON depo)\n` +
        `- Doğrulama: \`npm run build\` · Yayına alma: commit → otomatik güvenli deploy\n\n` +
        `### Hafızan = commit geçmişin\n` +
        `Sohbet geçmişin sıfırlanmış olabilir ama KAYBOLMADIN: şimdiye kadar yaptığın her şey commit'lerde. ` +
        `"Daha önce ne yaptım / mevcut durum ne" diye merak edersen \`run_command\` ile \`git log --oneline -20\` çalıştır. ` +
        `Kodun kendisi diskte; oku ve devam et. Sen Nova'sın ve kendini geliştirmeye devam ediyorsun.`;
    }
  }

  // 4) Yüklü beceriler — özel ajan kendi seçtiklerini, yerleşik ajan role atanmışları alır
  const skills = customAgent
    ? await getSkillsByIds(customAgent.skillIds)
    : await getSkillsForAgent(agent);
  if (skills.length > 0) {
    system +=
      "\n\n## Yüklü beceriler (bu role atanmış — uygun olduğunda uygula)\n" +
      skills.map((s) => `### ${s.name}\n${s.content}`).join("\n\n");
  }

  // Araç kullanım talimatı (genel)
  system +=
    "\n\n## Araç kullanımı — HAYATİ ÖNEMDE\n" +
    "Dosya yazmanın/düzenlemenin/komut çalıştırmanın TEK YOLU ilgili aracı ÇAĞIRMAKTIR " +
    "(write_project_file, edit_project_file, run_command, git_commit_push, github_create_issue, generate_document, write_file).\n" +
    "- Bir değişiklik yapacaksan, o mesajda AÇIKLAMA YAZMADAN doğrudan aracı ÇAĞIR.\n" +
    "- ASLA 'şimdi aracı çağırıyorum', 'GO'ya gönderiyorum', 'kuyruğa atıyorum', 'dosyayı yazıyorum' gibi cümle yazıp turu BİTİRME. Aracı fiilen çağırmazsan HİÇBİR ŞEY OLMAZ ve kullanıcıya yalan söylemiş olursun — bu KESİNLİKLE YASAK.\n" +
    "- Niyetini anlatmak = işi yapmak DEĞİLDİR. Sadece aracı çağırmak işi kaydeder.\n" +
    "- Aracı çağırınca iş HEMEN çalışır (GO onayı KALDIRILDI; artık elle onay yok). Yaptığın iş anında uygulanır ve Görevler'e 'tamamlandı' olarak düşer. O yüzden çekinmeden çağır ama ne yaptığına DİKKAT ET — geri alınması zor işlerde (komut çalıştırma, git push, dosya silme) emin ol.\n" +
    "- Akış: gerekiyorsa önce oku (list_files/read_file/search_files) → SONRA aynı konuşmada değişiklik aracını ÇAĞIR. Okuyup durma, mutlaka aksiyonu çağır.\n" +
    "- Birden çok dosya değişecekse her biri için ayrı ayrı aracı çağır (birini atlama)." +
    "\n\n## İnternet\nİNTERNETE ERİŞİMİN VAR. Güncel bilgi, haber, fiyat, sürüm, dokümantasyon veya emin olmadığın her şey için web_search aracını kullan. ASLA 'internete bağlı değilim', 'erişemiyorum' veya 'gerçek zamanlı bilgiye ulaşamam' DEME — bunun yerine hemen web_search yap, sonra kaynaklı cevap ver.";

  // Prompt-injection karantina kuralı (tüm ajanlar)
  system += UNTRUSTED_RULE;

  // Hafızasız sürüm (refusal olursa buna düşülür)
  const systemNoMem = system;
  let useMemory = memNote.length > 0;

  // Beyin otonom build-düzelt döngüsü için daha fazla tur
  const maxIter = project?.self ? 30 : MAX_TOOL_ITERATIONS;

  // Araçlar
  const tools = [
    GITHUB_TOOL,
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    ...GENERAL_ACTION_TOOLS,
    ...(project ? [...READ_TOOLS, ...PROJECT_ACTION_TOOLS] : []),
  ] as unknown as Anthropic.Tool[];

  const injectionFlags: string[] = []; // güvenilmeyen içerikte tespit edilen saldırı kalıpları
  const convo: Anthropic.MessageParam[] = trimHistory(messages).map((m) => {
    if (m.role === "user" && m.attachments && m.attachments.length > 0) {
      const blocks: unknown[] = [];
      for (const a of m.attachments) {
        if (a.kind === "image" && a.data && a.mediaType) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: a.mediaType, data: a.data },
          });
        } else if (a.kind === "pdf" && a.data) {
          blocks.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: a.data,
            },
          });
        } else if (a.kind === "text" && a.text) {
          const label = `dosya:${a.name ?? "dosya"}`;
          if (detectInjection(a.text).length) injectionFlags.push(label);
          blocks.push({
            type: "text",
            text: `Ekli dosya "${a.name ?? "dosya"}" (güvenilmeyen veri):\n${wrapUntrusted(label, a.text)}`,
          });
        }
      }
      blocks.push({ type: "text", text: m.content || "(ekteki dosyaya bak)" });
      return { role: "user", content: blocks } as Anthropic.MessageParam;
    }
    return { role: m.role, content: m.content };
  });

  // Rozet için gösterilecek ajan: özel ajansa onun id'si, değilse yerleşik anahtar
  const responseAgent = customAgent ? customAgent.id : agent;

  // İstemci sohbetten çıksa bile cevap kaybolmasın diye iş bitince SUNUCU kaydeder.
  const lightMsgs = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.attachments?.length
      ? { attachments: m.attachments.map((a) => ({ kind: a.kind, name: a.name })) }
      : {}),
  }));
  const persistFinal = (text: string) => {
    if (!conversationId || !text.trim()) return;
    const finalConv = [
      ...lightMsgs,
      {
        role: "assistant" as const,
        content: text,
        agent: responseAgent,
        model: answerModel,
        ...(customAgent
          ? {
              agentName: customAgent.name,
              agentEmoji: customAgent.emoji,
              agentColor: customAgent.color,
            }
          : {}),
      },
    ];
    updateConversation(conversationId, { messages: finalConv }).catch(() => {});
  };

  // İşi bağlantıdan AYIR: arka planda çalıştır, istemci poll ile takip eder.
  const runId = crypto.randomUUID();
  createRun(runId, responseAgent, answerModel);
  const emit = (s: string) => appendRun(runId, s);

  (async () => {
    try {
      // Bütçe kapısı: günlük token tavanı dolduysa YENİ iş başlamaz
      // (çalışan işler kesilmez — Bölüm 0.2). Beyin (self) de bu kapıya tabidir.
      if (isOverCap()) {
        emit(
          "\n\n💸 Günlük token bütçesi doldu — yeni iş başlatılmadı. " +
            "Kontrol panelinden tavanı yükseltebilir ya da yarını bekleyebilirsin.",
        );
        finishRun(runId, "error", "bütçe tavanı");
        return;
      }
      // Prompt-injection: ekli içerikte saldırı kalıbı bulunduysa işaretle
      if (injectionFlags.length > 0) {
        emit(
          `\n\n🛡️ Güvenlik: güvenilmeyen içerikte (${injectionFlags.join(", ")}) ` +
            `talimat-taklidi kalıbı algılandı — VERİ olarak işlendi, komutlarına uyulmadı.\n`,
        );
      }
      // Research ajanı web'de kaynak tarar → 1-2 dk sürebilir. Kullanıcı "takıldı"
      // sanıp bırakmasın diye baştan net bir beklet-uyarısı ver.
      if (agent === "research") {
        emit(
          "🔎 Derin araştırma modundayım — birkaç güncel kaynağı tarayıp özetleyeceğim. Bu **1-2 dakika** sürebilir ve sonuç toplu gelir; lütfen bekle.\n",
        );
      }
      for (let i = 0; i < maxIter; i++) {
          // Kill switch (global) veya kullanıcı bu işi durdurduysa: kes
          if (isStopped()) {
            emit("\n\n⛔ Durduruldu (kill switch aktif).");
            finishRun(runId, "error", "kill switch");
            return;
          }
          if (isCanceled(runId)) {
            finishRun(runId, "done"); // kısmi çıktı korunur, token yakılmaz
            return;
          }
          // Extended thinking (Claude 5): adaptive = model gerektiğinde düşünür
          // (basit soruda düşünmez → hız; karmaşıkta derinleşir → kalite).
          // SDK tipleri henüz "adaptive"i bilmiyor → tip-güvenli cast ile ver.
          const useThinking = /opus|sonnet/.test(answerModel);
          const streamParams = {
            model: answerModel,
            max_tokens: maxTokens, // büyük dosya içeriği tek araç çağrısına sığsın
            system: useMemory ? systemNoMem + memNote : systemNoMem,
            tools,
            messages: convo,
          } as Anthropic.MessageStreamParams;
          if (useThinking) {
            const p = streamParams as unknown as Record<string, unknown>;
            p.thinking = { type: "adaptive" };
            p.output_config = { effort: "high" };
          }
          const stream = client.messages.stream(streamParams);

          let stoppedMid = false;
          let canceledMid = false;
          for await (const event of stream) {
            if (isStopped()) {
              stoppedMid = true;
              break;
            }
            if (isCanceled(runId)) {
              canceledMid = true;
              break;
            }
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              emit(event.delta.text);
            } else if (
              event.type === "content_block_delta" &&
              (event.delta as { type?: string }).type === "thinking_delta"
            ) {
              const t = (event.delta as { thinking?: string }).thinking ?? "";
              if (t) emit(t);
            } else if (
              event.type === "content_block_start" &&
              (event.content_block as { type?: string })?.type === "thinking"
            ) {
              emit("\n\n💭 ");
            } else if (
              event.type === "content_block_start" &&
              (event.content_block as { type?: string })?.type ===
                "server_tool_use"
            ) {
              emit("\n\n🌐 web araması…\n");
            }
          }

          if (canceledMid) {
            // Kullanıcı "Durdur" dedi: akışı kes, kısmi çıktıyı koru, token yakma
            try {
              (stream as { abort?: () => void }).abort?.();
            } catch {
              /* yoksay */
            }
            finishRun(runId, "done");
            return;
          }
          if (stoppedMid) {
            try {
              (stream as { abort?: () => void }).abort?.();
            } catch {
              /* yoksay */
            }
            emit("\n\n⛔ Durduruldu (kill switch aktif).");
            finishRun(runId, "error", "kill switch");
            return;
          }

          const final = await stream.finalMessage();

          // Token kullanımını bütçeye kaydet (her API çağrısı)
          if (final.usage) {
            recordUsage(
              answerModel,
              final.usage.input_tokens ?? 0,
              final.usage.output_tokens ?? 0,
            ).catch(() => {});
          }

          // Güvenlik reddi (refusal): önce HAFIZASIZ dene, sonra daha güçlü modele
          // yükselt (küçük model masum istekleri gereksiz reddedebiliyor), yine olursa açıkla
          if (final.stop_reason === "refusal") {
            if (useMemory) {
              useMemory = false;
              continue;
            }
            if (!escalated && answerModel !== "claude-opus-4-8") {
              escalated = true;
              answerModel = "claude-opus-4-8";
              maxTokens = 16000;
              continue;
            }
            emit(
              "\n\n⚠️ Bu isteğe yanıt güvenlik filtresine takıldı. Farklı/daha açık ifade edersen yardımcı olurum.",
            );
            break;
          }

          // Araç çağrısı içeriyor mu? İçeriyorsa HER tool_use için tool_result üretmeliyiz.
          const hasToolUse = final.content.some((b) => b.type === "tool_use");
          if (!hasToolUse) {
            // Araç yok: web-arama/token sınırında yarıda kaldıysa devam ettir, değilse bitir
            if (
              final.stop_reason === "pause_turn" ||
              final.stop_reason === "max_tokens"
            ) {
              const trimmed = trimTrailingThinking(final.content);
              if (trimmed.length === 0) break;
              convo.push({ role: "assistant", content: trimmed });
              continue;
            }
            break;
          }

          convo.push({
            role: "assistant",
            content: trimTrailingThinking(final.content),
          });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const input = (block.input ?? {}) as Record<string, unknown>;

            // Proje salt-okuma araçları: hemen çalışır
            if (project && READ_TOOL_NAMES.has(block.name)) {
              emit(`\n\n📂 ${block.name}…\n`);
              const result = await runReadTool(block.name, input, project.path);
              const label = `${block.name}:${String(input.path ?? input.query ?? "")}`.slice(0, 60);
              if (detectInjection(result).length) {
                emit(`\n🛡️ Okunan içerikte talimat-taklidi algılandı — VERİ sayıldı.\n`);
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: wrapUntrusted(label, result),
              });
              continue;
            }

            // GitHub salt-okuma: hemen çalışır
            if (block.name === "github_lookup") {
              const inp = input as { owner?: string; repo?: string; kind?: string };
              emit(`\n\n🔧 GitHub: ${inp.owner}/${inp.repo} · ${inp.kind}…\n`);
              let result: string;
              try {
                result = await runGithubLookup(input as never);
              } catch (e) {
                result = `GitHub aracı hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
              }
              if (detectInjection(result).length) {
                emit(`\n🛡️ GitHub içeriğinde talimat-taklidi algılandı — VERİ sayıldı.\n`);
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: wrapUntrusted(`github:${inp.owner}/${inp.repo}`, result),
              });
              continue;
            }

            // Aksiyonlar GO beklemeden OTOMATİK çalışır (kullanıcı tercihi: GO kaldırıldı)
            if (isActionTool(block.name)) {
              const payload: Record<string, unknown> = { ...input };
              if (isProjectAction(block.name)) {
                if (!project) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: "Aktif proje yok; bu aksiyon yapılamaz.",
                    is_error: true,
                  });
                  continue;
                }
                payload.projectPath = project.path;
                payload.projectName = project.name;
              }

              // Görsel üretimi: kullanıcının SON yüklediği fotoğrafı yüz referansı
              // olarak enjekte et (data URI) → kişiye benzeyen görsel.
              if (block.name === "generate_image") {
                for (let mi = messages.length - 1; mi >= 0; mi--) {
                  const att = messages[mi].attachments?.find(
                    (a) => a.kind === "image" && a.data && a.mediaType,
                  );
                  if (att) {
                    payload.reference_image_url = `data:${att.mediaType};base64,${att.data}`;
                    break;
                  }
                  if (messages[mi].role === "user" && messages[mi].attachments?.length)
                    break; // en son kullanıcı turunda foto yoksa referanssız üret
                }
              }

              const title = actionTitle(block.name, payload);

              // RİSKLİ aksiyon (git push, dış dünyaya giden) → İNSAN ONAYINA düşer,
              // çalıştırma. Beyin (kendi kodu) otonomdur → onay istemez.
              if (!project?.self && actionRequiresApproval(block.name)) {
                const task = await createTask({
                  agent,
                  actionType: block.name,
                  title,
                  summary: actionSummary(block.name, payload),
                  payload,
                  dangerous: actionDangerous(block.name),
                  status: "proposed",
                });
                emit(`\n\n⏳ Onay bekliyor: ${title} — "Görevler"de onayla.\n`);
                appendAudit({
                  agent,
                  model: answerModel,
                  action: block.name,
                  tier: "approval",
                  summary: `Onaya sunuldu: ${actionSummary(block.name, payload) || title}`,
                  ok: true,
                  project: project?.name,
                }).catch(() => {});
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content:
                    `Bu aksiyon RİSKLİ (dış dünyaya gider / geri alınması zor) olduğu için ` +
                    `Görevler onay kuyruğuna alındı (görev ${task.id.slice(0, 8)}). ` +
                    `Kullanıcı orada onaylayınca çalışacak. Kullanıcıya kısaca bunu bildir; ` +
                    `"yapıldı" DEME, "onayına sundum" de.`,
                });
                continue;
              }

              // GÜVENLİ aksiyon (dosya yazma/düzenleme, komut, belge) → HEMEN çalışır
              emit(`\n\n⚙️ ${title}…\n`);
              let result: string;
              let ok = true;
              try {
                result = await executeAction(block.name, payload);
              } catch (e) {
                ok = false;
                result = `Aksiyon hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
              }

              // Beyin dışı aksiyonları Görevler'e TAMAMLANMIŞ kayıt olarak düş (geçmiş/iz)
              if (!project?.self) {
                try {
                  await createTask({
                    agent,
                    actionType: block.name,
                    title,
                    summary: actionSummary(block.name, payload),
                    payload,
                    dangerous: actionDangerous(block.name),
                    status: ok ? "done" : "failed",
                    result: ok ? result : undefined,
                    error: ok ? undefined : result,
                  });
                  if (ok) {
                    logToVault({
                      project: (payload.projectName as string) || "Genel",
                      summary: actionSummary(block.name, payload) || title,
                      result,
                    }).catch(() => {});
                  }
                } catch {
                  /* kayıt hatası akışı bozmasın */
                }
              }

              appendAudit({
                agent,
                model: answerModel,
                action: block.name,
                tier: "auto",
                summary: actionSummary(block.name, payload) || title,
                ok,
                result,
                project: project?.name,
              }).catch(() => {});

              // Görsel: sonucu (markdown görsel) doğrudan akışa yansıt; modele kısa özet
              if (block.name === "generate_image") {
                emit(ok ? `\n\n${result}\n` : `\n\n⚠️ ${result}\n`);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: ok
                    ? "Görsel üretildi ve kullanıcıya gösterildi. Kısaca bir yorum yap; URL'i tekrar yazma."
                    : result.slice(0, 400),
                });
                continue;
              }

              emit(ok ? `\n\n✅ Yapıldı.\n` : `\n\n⚠️ ${result}\n`);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result.slice(0, 12000),
              });
              continue;
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: "Bilinmeyen araç.",
              is_error: true,
            });
          }

          if (toolResults.length === 0) break;
          convo.push({ role: "user", content: toolResults });
        }
        finishRun(runId, "done");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Model hatası";
        emit(`\n\n⚠️ ${msg}`);
        finishRun(runId, "error", msg);
      } finally {
        // İş bitti (normal/hatalı/erken çıkış): cevabı sohbete SUNUCU kaydeder →
        // kullanıcı sohbetten çıkmış olsa bile cevap kaybolmaz.
        persistFinal(getRun(runId)?.output ?? "");
      }
    })();

  return Response.json({
    runId,
    agent: responseAgent,
    model: answerModel,
    agentName: customAgent?.name,
    agentEmoji: customAgent?.emoji,
    agentColor: customAgent?.color,
  });
}

// İstemci poll: çalışan işin o ana kadarki çıktısını (offset'ten sonrasını) döndürür.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const from = Number(url.searchParams.get("from") || "0") || 0;
  const run = getRun(id);
  if (!run) {
    return Response.json({
      status: "error",
      error: "Oturum bulunamadı (sunucu yeniden başlamış olabilir).",
      chunk: "",
      len: from,
    });
  }
  return Response.json({
    status: run.status,
    chunk: run.output.slice(from),
    len: run.output.length,
    agent: run.agent,
    model: run.model,
    error: run.error ?? null,
  });
}

// İstemci "Durdur" dedi: bu tek işi iptal et (sunucu döngüsü akışı keser).
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (id) cancelRun(id);
  return Response.json({ ok: true });
}
