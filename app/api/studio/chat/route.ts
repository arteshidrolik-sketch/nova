// Stüdyo sohbeti: doğrudan pod'daki Ollama'ya (SSH köprüsü üzerinden) akışlı sohbet.
// Claude/Anthropic'e UĞRAMAZ — sansürsüz, yerel modelin kendisi cevap verir.
import { ollamaChatStream } from "@/lib/brain/ollama";
import { ensureFromCfg, tunnelTarget } from "@/lib/studio/tunnel";
import { ensurePodReady, podAutomationReady, touchPod } from "@/lib/studio/pod";
import { buildSystemPrompt } from "@/lib/studio/skills";

export const runtime = "nodejs";
export const maxDuration = 600;

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { model?: string; messages?: Msg[]; skills?: string[] };
  const model = String(b.model ?? "huihui_ai/qwen2.5-coder-abliterate:32b");
  const convo = Array.isArray(b.messages) ? b.messages.filter((m) => m && m.content && m.role !== "system") : [];
  if (!convo.length) return Response.json({ error: "mesaj yok" }, { status: 400 });
  // Beceriler → sistem talimatı, her istekte en başa (modelin tarzını belirler)
  const messages: Msg[] = [{ role: "system", content: buildSystemPrompt(b.skills) }, ...convo];

  touchPod();
  if (podAutomationReady()) {
    try { await ensurePodReady(); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "pod hazırlanamadı" }, { status: 503 }); }
  }
  if (!tunnelTarget()) await ensureFromCfg();
  if (!tunnelTarget()) return Response.json({ error: "Pod bağlı değil. Önce Admin'de bağlan." }, { status: 409 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await ollamaChatStream("http://127.0.0.1:11434", model, messages, (t) => {
          controller.enqueue(encoder.encode(t));
        });
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n⚠️ ${e instanceof Error ? e.message : "hata"}`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
