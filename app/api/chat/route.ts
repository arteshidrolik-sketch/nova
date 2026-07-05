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
  actionTitle,
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
  createRun,
  finishRun,
  getRun,
} from "@/lib/runs/store";
import {
  getActiveId,
  getProjectByConversation,
  setActive,
} from "@/lib/projects/store";
import { getSkillsForAgent } from "@/lib/skills/store";

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
  if (messages.length === 0) {
    return new Response("Mesaj bulunamadı.", { status: 400 });
  }

  const client = new Anthropic();

  // Proje bağlamı — bulunduğun SOHBETE bağlı proje (global aktif değil)
  const project = conversationId
    ? await getProjectByConversation(conversationId)
    : null;
  // UI tutarlılığı için global aktifi de senkronla
  if (project && (await getActiveId()) !== project.id) {
    await setActive(project.id);
  }

  // 1) Orkestratör — beyin (kendi kodu) HER ZAMAN developer + Opus 4.8; değilse router
  const agent = project?.self
    ? "developer"
    : await selectAgent(client, ROUTER_MODEL, messages);
  const answerModel = project?.self ? "claude-opus-4-8" : modelForAgent(agent);
  // Büyük dosya yazımı kesilmesin diye güçlü modellerde daha yüksek çıktı limiti
  const maxTokens = /opus|sonnet/.test(answerModel) ? 16000 : 8000;

  // 2) Hafıza — sona ayrı eklenir; güvenlik reddi (refusal) olursa hafızasız tekrar denenir
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const relevant = await searchMemories(lastUser, 3);
  const memNote =
    relevant.length > 0
      ? "\n\n## İlgili geçmiş notlar (hafıza)\nBunları gerektiğinde kullan, gereksizse görmezden gel:\n" +
        relevant.map((m) => `- ${m.summary}`).join("\n")
      : "";
  let system = SYSTEM_PROMPTS[agent];

  if (project) {
    system +=
      `\n\n## Aktif proje: ${project.name}\nYerel yol: ${project.path}\n` +
      `Bu proje üzerinde çalışıyorsun. Bir şey söylemeden ÖNCE dosyaları incele: ` +
      `önce list_files ile yapıyı gör, search_files ile ilgili yeri bul, read_file ile oku. ` +
      `Tahmin etme. Değişiklik gerekiyorsa write_project_file (yeni/tam dosya) veya ` +
      `edit_project_file (metin değişikliği) öner — bunlar kullanıcı onayı (GO) gerektirir.`;

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

  // 4) Bu role yüklenmiş beceriler
  const skills = await getSkillsForAgent(agent);
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
    "- Aracı çağırmak işi hemen ÇALIŞTIRMAZ; 'öneri/görev' olarak kaydeder, kullanıcı Görevler'de GO ile onaylar. O yüzden ÇEKİNMEDEN çağır, izin isteme.\n" +
    "- Akış: gerekiyorsa önce oku (list_files/read_file/search_files) → SONRA aynı konuşmada değişiklik aracını ÇAĞIR. Okuyup durma, mutlaka aksiyonu çağır.\n" +
    "- Birden çok dosya değişecekse her biri için ayrı ayrı aracı çağır (birini atlama)." +
    "\n\n## İnternet\nİNTERNETE ERİŞİMİN VAR. Güncel bilgi, haber, fiyat, sürüm, dokümantasyon veya emin olmadığın her şey için web_search aracını kullan. ASLA 'internete bağlı değilim', 'erişemiyorum' veya 'gerçek zamanlı bilgiye ulaşamam' DEME — bunun yerine hemen web_search yap, sonra kaynaklı cevap ver.";

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
          blocks.push({
            type: "text",
            text: `Ekli dosya "${a.name ?? "dosya"}":\n${a.text}`,
          });
        }
      }
      blocks.push({ type: "text", text: m.content || "(ekteki dosyaya bak)" });
      return { role: "user", content: blocks } as Anthropic.MessageParam;
    }
    return { role: m.role, content: m.content };
  });

  // İşi bağlantıdan AYIR: arka planda çalıştır, istemci poll ile takip eder.
  const runId = crypto.randomUUID();
  createRun(runId, agent, answerModel);
  const emit = (s: string) => appendRun(runId, s);

  (async () => {
    try {
      for (let i = 0; i < maxIter; i++) {
          const stream = client.messages.stream({
            model: answerModel,
            max_tokens: maxTokens, // büyük dosya içeriği tek araç çağrısına sığsın
            system: useMemory ? systemNoMem + memNote : systemNoMem,
            tools,
            messages: convo,
          });

          for await (const event of stream) {
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

          const final = await stream.finalMessage();

          // Güvenlik reddi (refusal): önce HAFIZASIZ tekrar dene (hafıza notu tetiklemiş olabilir), yine olursa açıkla
          if (final.stop_reason === "refusal") {
            if (useMemory) {
              useMemory = false;
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
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
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
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
              continue;
            }

            // Yazma/tehlikeli: GO-onaylı görev
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

              // Beyin (kendi kodu): GO beklemeden OTONOM çalıştır — oku/düzenle/build/düzelt/commit döngüsü
              if (project?.self) {
                emit(`\n\n⚙️ ${block.name}…\n`);
                let result: string;
                try {
                  result = await executeAction(block.name, payload);
                } catch (e) {
                  result = `Aksiyon hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
                }
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: result.slice(0, 12000),
                });
                continue;
              }

              const task = await createTask({
                agent,
                actionType: block.name,
                title: actionTitle(block.name, payload),
                payload,
                dangerous: actionDangerous(block.name),
              });
              emit(
                `\n\n📋 Öneri oluşturuldu: ${task.title} — "Görevler"de onayını (GO) bekliyor.\n`,
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: `Aksiyon onaya gönderildi (görev ${task.id.slice(0, 8)}). Kullanıcı GO dediğinde uygulanacak. Kullanıcıya bunu kısaca bildir.`,
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
      }
    })();

  return Response.json({ runId, agent, model: answerModel });
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
