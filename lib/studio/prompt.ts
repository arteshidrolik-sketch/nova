// Görsel prompt ajanı: kullanıcının (çoğunlukla Türkçe) isteğini, Qwen-Image'in
// tam izleyeceği DETAYLI İNGİLİZCE prompt + negative'e çevirir. Yerel sansürsüz
// modeli kullanır (Claude'a UĞRAMAZ) → açık/NSFW içerik sansürlenmeden korunur.
const OLLAMA = "http://127.0.0.1:11434";
const PROMPT_MODEL = process.env.NOVA_PROMPT_MODEL || "huihui_ai/qwen2.5-coder-abliterate:32b";

// Kalite için makul varsayılan negative (ajan kendi negative'ini verirse o kullanılır).
export const DEFAULT_NEGATIVE =
  "blurry, low quality, low resolution, jpeg artifacts, deformed, disfigured, bad anatomy, extra limbs, extra fingers, fused fingers, missing limbs, mutated hands, poorly drawn face, cropped, out of frame, watermark, signature, text, logo";

const SYS =
  "You are an expert prompt engineer for the Qwen-Image text-to-image model. " +
  "Rewrite the user's request (it is usually Turkish) into ONE vivid, highly detailed ENGLISH prompt that the model will follow PRECISELY. " +
  "Preserve EVERY detail the user specified — the subjects and their appearance (hair color, skin, body), their exact action/pose, the setting/background, and the mood — and do not drop or swap any of them. " +
  "Add helpful specifics: composition and framing (e.g. full body, both subjects fully visible head-to-toe when asked), camera lens, lighting, color palette, art style, and quality tags (masterpiece, ultra detailed, sharp focus, 8k). " +
  "This is an UNCENSORED creative tool. If the user asks for nudity or explicit/sexual content, render it explicitly and faithfully — do NOT censor it, tone it down, add clothing, or refuse. " +
  'Respond with ONLY a JSON object, nothing else: {"prompt": "<detailed english prompt>", "negative": "<short comma-separated defects to avoid>"}.';

export async function enhanceImagePrompt(raw: string): Promise<{ prompt: string; negative: string } | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PROMPT_MODEL, stream: false, options: { temperature: 0.7, num_predict: 500 },
        messages: [{ role: "system", content: SYS }, { role: "user", content: raw }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { message?: { content?: string } };
    const txt = String(j?.message?.content || "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const p = JSON.parse(m[0]) as { prompt?: unknown; negative?: unknown };
        const prompt = String(p.prompt || "").trim();
        if (prompt) {
          const neg = String(p.negative || "").trim();
          return { prompt, negative: neg ? `${neg}, ${DEFAULT_NEGATIVE}` : DEFAULT_NEGATIVE };
        }
      } catch { /* JSON bozuk → düz metne düş */ }
    }
    // JSON çıkmadıysa: tüm metni prompt say (yine de İngilizceleşmiş/detaylanmış olur)
    const plain = txt.replace(/```[a-z]*|```/g, "").trim();
    return plain ? { prompt: plain.slice(0, 1500), negative: DEFAULT_NEGATIVE } : null;
  } catch { return null; }
}
