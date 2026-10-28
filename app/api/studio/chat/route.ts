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
  const b = (await req.json().catch(() => ({}))) as { model?: string; messages?: Msg[]; skills?: string[]; images?: string[]; persona?: string };
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
  const messages: Msg[] = [{ role: "system", content: buildSystemPrompt(b.skills, b.persona) }, ...convo];
  if (vision) {
    // görselleri son kullanıcı mesajına ekle
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "user") { messages[i] = { ...messages[i], images: imgs }; break; } }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enq = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { /* kapandı */ } };
      try {
        // Pod hazırlığı AKIŞIN İÇİNDE: ilk byte hemen gider, pod uyanırken ilerleme
        // akar → bağlantı canlı kalır, proxy (Cloudflare 100sn) kesmez. Sohbet için
        // ComfyUI beklenmez (needComfy:false) — ~1 dk kazanç.
        touchPod();
        if (podAutomationReady()) {
          try { await ensurePodReady((s) => enq(`⏳ ${s}\n`), { needComfy: false }); }
          catch (e) { enq(`⚠️ ${e instanceof Error ? e.message : "pod hazırlanamadı"}`); controller.close(); return; }
        }
        if (!tunnelTarget()) await ensureFromCfg();
        if (!tunnelTarget()) { enq("⚠️ Pod bağlı değil. Önce Admin'de bağlan."); controller.close(); return; }

        // Görü modeli ilk kez kullanılıyorsa pod'a indir (bir kez, /workspace'e kalıcı)
        if (vision && !(await ollamaHasModel(OLLAMA, model))) {
          enq(`📥 Görü modeli (${model}) ilk kez kuruluyor, birkaç dakika sürebilir…\n\n`);
          await ollamaPull(OLLAMA, model);
        }
        await ollamaChatStream(OLLAMA, model, messages, enq);
      } catch (e) {
        enq(`\n\n⚠️ ${e instanceof Error ? e.message : "hata"}`);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
