// Stüdyo sohbeti: doğrudan pod'daki Ollama'ya (SSH köprüsü üzerinden) akışlı sohbet.
// Claude/Anthropic'e UĞRAMAZ — sansürsüz, yerel modelin kendisi cevap verir.
import { ollamaChatStream } from "@/lib/brain/ollama";
import { ensureFromCfg, tunnelTarget } from "@/lib/studio/tunnel";

export const runtime = "nodejs";
export const maxDuration = 300;

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { model?: string; messages?: Msg[] };
  const model = String(b.model ?? "huihui_ai/qwen2.5-coder-abliterate:32b");
  const messages = Array.isArray(b.messages) ? b.messages.filter((m) => m && m.content) : [];
  if (!messages.length) return Response.json({ error: "mesaj yok" }, { status: 400 });

  if (!tunnelTarget()) await ensureFromCfg();
  if (!tunnelTarget()) return Response.json({ error: "Pod bağlı değil. Önce Stüdyo'da bağlan." }, { status: 409 });

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
