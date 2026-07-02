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
  isActionTool,
  isProjectAction,
} from "@/lib/tools/actions";
import {
  READ_TOOLS,
  READ_TOOL_NAMES,
  runReadTool,
} from "@/lib/tools/projectFiles";
import { createTask } from "@/lib/tasks/store";
import { getActiveProject } from "@/lib/projects/store";
import { getSkillsForAgent } from "@/lib/skills/store";

export const runtime = "nodejs";

// Router: hızlı ve ucuz model yeterli (sadece ajan seçer)
const ROUTER_MODEL = process.env.NOVA_ROUTER_MODEL || "claude-fable-5";
const MAX_TOOL_ITERATIONS = 8;

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

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      "ANTHROPIC_API_KEY tanımlı değil. .env.local dosyana ekle ve sunucuyu yeniden başlat.",
      { status: 500 },
    );
  }

  let messages: IncomingMessage[];
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return new Response("Geçersiz istek gövdesi.", { status: 400 });
  }
  if (messages.length === 0) {
    return new Response("Mesaj bulunamadı.", { status: 400 });
  }

  const client = new Anthropic();

  // 1) Orkestratör
  const agent = await selectAgent(client, ROUTER_MODEL, messages);
  const answerModel = modelForAgent(agent); // ajana göre model (genel→fable, kodlama→opus)

  // 2) Hafıza
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const relevant = await searchMemories(lastUser, 3);
  let system = SYSTEM_PROMPTS[agent];
  if (relevant.length > 0) {
    system +=
      "\n\n## İlgili geçmiş notlar (hafıza)\nBunları gerektiğinde kullan, gereksizse görmezden gel:\n" +
      relevant.map((m) => `- ${m.summary}`).join("\n");
  }

  // 3) Aktif proje
  const project = await getActiveProject();
  if (project) {
    system +=
      `\n\n## Aktif proje: ${project.name}\nYerel yol: ${project.path}\n` +
      `Bu proje üzerinde çalışıyorsun. Bir şey söylemeden ÖNCE dosyaları incele: ` +
      `önce list_files ile yapıyı gör, search_files ile ilgili yeri bul, read_file ile oku. ` +
      `Tahmin etme. Değişiklik gerekiyorsa write_project_file (yeni/tam dosya) veya ` +
      `edit_project_file (metin değişikliği) öner — bunlar kullanıcı onayı (GO) gerektirir.`;
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
    "\n\n## Araç kullanımı\nGO-onaylı aksiyonları (git_commit_push, write_project_file, edit_project_file, github_create_issue, generate_document, write_file) kullanıcıya ÖNCE SORMADAN doğrudan çağır. Bir aracı çağırmak işi ÇALIŞTIRMAZ — sadece 'öneri/görev' olarak kaydeder; kullanıcı Görevler ekranından GO ile onaylar. 'GO bekliyorum' yazıp durma; uygun aracı hemen çağır. Salt-okuma araçlarını (list_files, read_file, search_files, github_lookup) gerektiğinde serbestçe kullan." +
    "\n\n## İnternet\nİNTERNETE ERİŞİMİN VAR. Güncel bilgi, haber, fiyat, sürüm, dokümantasyon veya emin olmadığın her şey için web_search aracını kullan. ASLA 'internete bağlı değilim', 'erişemiyorum' veya 'gerçek zamanlı bilgiye ulaşamam' DEME — bunun yerine hemen web_search yap, sonra kaynaklı cevap ver.";

  // Araçlar
  const tools = [
    GITHUB_TOOL,
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    ...GENERAL_ACTION_TOOLS,
    ...(project ? [...READ_TOOLS, ...PROJECT_ACTION_TOOLS] : []),
  ] as unknown as Anthropic.Tool[];

  const convo: Anthropic.MessageParam[] = messages.map((m) => {
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

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const stream = client.messages.stream({
            model: answerModel,
            max_tokens: 4096,
            system,
            tools,
            messages: convo,
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            } else if (
              event.type === "content_block_start" &&
              (event.content_block as { type?: string })?.type ===
                "server_tool_use"
            ) {
              controller.enqueue(encoder.encode("\n\n🌐 web araması…\n"));
            }
          }

          const final = await stream.finalMessage();

          // Sunucu aracı (web arama) tur sınırına takıldı → devam ettir
          if (final.stop_reason === "pause_turn") {
            convo.push({ role: "assistant", content: final.content });
            continue;
          }
          if (final.stop_reason !== "tool_use") break;

          convo.push({ role: "assistant", content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const input = (block.input ?? {}) as Record<string, unknown>;

            // Proje salt-okuma araçları: hemen çalışır
            if (project && READ_TOOL_NAMES.has(block.name)) {
              controller.enqueue(
                encoder.encode(`\n\n📂 ${block.name}…\n`),
              );
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
              controller.enqueue(
                encoder.encode(
                  `\n\n🔧 GitHub: ${inp.owner}/${inp.repo} · ${inp.kind}…\n`,
                ),
              );
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
              const task = await createTask({
                agent,
                actionType: block.name,
                title: actionTitle(block.name, payload),
                payload,
                dangerous: actionDangerous(block.name),
              });
              controller.enqueue(
                encoder.encode(
                  `\n\n📋 Öneri oluşturuldu: ${task.title} — "Görevler"de onayını (GO) bekliyor.\n`,
                ),
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
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Model hatası";
        controller.enqueue(encoder.encode(`\n\n⚠️ ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Nova-Agent": agent,
    },
  });
}
