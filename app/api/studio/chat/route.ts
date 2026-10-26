// Stüdyo sohbeti: doğrudan pod'daki Ollama'ya (SSH köprüsü üzerinden) akışlı sohbet.
// Claude/Anthropic'e UĞRAMAZ — sansürsüz, yerel modelin kendisi cevap verir.
import { ollamaChatStream, ollamaHasModel, ollamaPull } from "@/lib/brain/ollama";
import { ensureFromCfg, tunnelTarget } from "@/lib/studio/tunnel";
import { ensurePodReady, podAutomationReady, touchPod } from "@/lib/studio/pod";
import { buildSystemPrompt } from "@/lib/studio/skills";

export const runtime = "nodejs";
export const maxDuration = 600;

const OLLAMA = "http://127.0.0.1:11434";
const VISION_MODEL = process.env.NOVA_VISION_MODEL || "llama3.2-vision:11b";
type Msg = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { model?: string; messages?: Msg[]; skills?: string[]; images?: string[] };
  const convo = Array.isArray(b.messages) ? b.messages.filter((m) => m && m.content && m.role !== "system") : [];
  if (!convo.length) return Response.json({ error: "mesaj yok" }, { status: 400 });

  // Görsel (resim/video karesi) varsa → görü modeli; yoksa normal kodlama modeli
  const imgs = (Array.isArray(b.images) ? b.images : [])
    .map((s) => String(s).replace(/^data:[^;]+;base64,/, "")) // sadece base64 kısmı
    .filter(Boolean)
    .slice(0, 8); // en fazla 8 kare/resim
  const vision = imgs.length > 0;
  const model = vision ? VISION_MODEL : String(b.model ?? "huihui_ai/qwen2.5-coder-abliterate:32b");

  // Beceriler → sistem talimatı, her istekte en başa (modelin tarzını belirler)
  const messages: Msg[] = [{ role: "system", content: buildSystemPrompt(b.skills) }, ...convo];
  if (vision) {
    // görselleri son kullanıcı mesajına ekle
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "user") { messages[i] = { ...messages[i], images: imgs }; break; } }
  }

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
        // Görü modeli ilk kez kullanılıyorsa pod'a indir (bir kez, /workspace'e kalıcı)
        if (vision && !(await ollamaHasModel(OLLAMA, model))) {
          controller.enqueue(encoder.encode(`📥 Görü modeli (${model}) ilk kez kuruluyor, birkaç dakika sürebilir…\n\n`));
          await ollamaPull(OLLAMA, model);
        }
        await ollamaChatStream(OLLAMA, model, messages, (t) => {
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
