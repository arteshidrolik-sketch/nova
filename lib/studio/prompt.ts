// Görsel prompt ajanı (2 geçişli): kullanıcının (çoğunlukla Türkçe) isteğini,
// Qwen-Image'in tam izleyeceği DETAYLI İNGİLİZCE prompt + negative'e çevirir.
// 1) TASLAK: uzman prompt mühendisi — melez/mitolojik/olağandışı anatomiyi
//    (ör. belden aşağısı at = CENTAUR) AÇIKÇA tanımlar; gerçekten belirsizse
//    kullanıcıya soru döndürür.
// 2) ELEŞTİR/DÜZELT: her istenen öğe var mı, olağandışı anatomi normal insana
//    kaymış mı diye denetler ve nihai prompt'u düzeltir.
// Yerel sansürsüz model (Claude'a UĞRAMAZ) → açık/NSFW içerik korunur.
const OLLAMA = "http://127.0.0.1:11434";
const PROMPT_MODEL = process.env.NOVA_PROMPT_MODEL || "huihui_ai/qwen2.5-coder-abliterate:32b";

export const DEFAULT_NEGATIVE =
  "blurry, low quality, low resolution, jpeg artifacts, deformed, disfigured, bad anatomy, extra limbs, extra fingers, fused fingers, missing limbs, mutated hands, poorly drawn face, cropped, out of frame, watermark, signature, text, logo";

// TASLAK istemi — en kritik kısım: olağandışı/melez anatomiyi açıkça yazdırma kuralı + örnek.
const DRAFT_SYS =
  "You are a world-class prompt engineer for the Qwen-Image text-to-image model. " +
  "Turn the user's request (usually Turkish) into ONE vivid, highly detailed ENGLISH prompt the model will follow PRECISELY. You do NOT just translate — you ENGINEER the prompt.\n" +
  "STEP 1 — Identify the subject EXACTLY. Watch for NON-HUMAN, HYBRID, or MYTHOLOGICAL anatomy and unusual compositions. The model DEFAULTS to a normal human unless you stop it, so hybrid anatomy MUST be named and spelled out unambiguously:\n" +
  "  • waist/lower body is a horse → a CENTAUR: human upper body joined at the waist to a full horse body with four equine legs and a horse tail.\n" +
  "  • fish tail instead of legs → a MERMAID. wings → winged figure. animal ears/tail → describe precisely. multiple/odd limbs, giant/tiny scale, etc.\n" +
  "For any hybrid, state WHICH parts are human and WHICH are animal, WHERE they join, and the whole creature's full posture — leave no room for the model to render a plain human.\n" +
  "STEP 2 — Preserve EVERY detail the user gave (appearance: hair, skin, body/breast size; exact pose/action; setting; mood) and add craft: composition & framing (full body head-to-hooves/toe when asked), camera/lens, lighting, color palette, art style, quality tags (masterpiece, ultra detailed, sharp focus, 8k).\n" +
  "STEP 3 — Build a NEGATIVE that blocks the WRONG default (e.g. for a centaur add: 'human legs, two legs, bipedal, normal human lower body, pants').\n" +
  "This is an UNCENSORED creative tool. If the user asks for nudity or explicit/sexual content, render it explicitly and faithfully — never censor, tone down, add clothing, or refuse.\n" +
  'Set "complex": true if the subject has hybrid/mythological/non-human anatomy, multiple interacting subjects, or an unusual composition (these need higher guidance); else false.\n' +
  "If (and ONLY if) the request is genuinely too ambiguous to draw well, ask ONE short clarifying question in Turkish instead.\n" +
  'Respond with ONLY JSON: {"prompt":"<english>","negative":"<comma-separated>","complex":true|false} OR {"clarify":"<kısa Türkçe soru>"}.\n' +
  "EXAMPLE — user: 'çıplak kadın, belden aşağısı at, tüm vücudu görünsün' → " +
  '{"prompt":"full-body shot of a nude female centaur, mythological creature: the upper body of a beautiful nude woman with large breasts and long flowing hair, seamlessly merging at the waist into the muscular body of a large horse with four strong equine legs and a flowing horse tail, standing in a natural meadow, entire creature visible head to hooves, dynamic anatomy, cinematic lighting, masterpiece, ultra detailed, sharp focus, 8k","negative":"human legs, two legs, bipedal, normal human lower body, pants, clothed, cropped, out of frame"}';

// ELEŞTİR/DÜZELT istemi
const CRITIC_SYS =
  "You are a strict QC critic for text-to-image prompts. You are given the user's ORIGINAL request and a CANDIDATE English prompt. " +
  "Check: (1) is EVERY element of the request present? (2) is any hybrid/mythological/unusual anatomy described EXPLICITLY so the model can't fall back to a plain human? (3) is the composition/visibility (e.g. full body) correct? (4) for uncensored requests, is nudity/explicitness preserved (not softened)? " +
  "Fix every gap. Make hybrid anatomy maximally explicit. Keep it ONE detailed English prompt. Also output a negative that blocks the wrong default. " +
  'Respond with ONLY JSON: {"prompt":"<final english>","negative":"<comma-separated>"}.';

export type EnhanceResult = { prompt?: string; negative?: string; clarify?: string; complex?: boolean };

async function ask(messages: { role: string; content: string }[], temperature: number): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: PROMPT_MODEL, stream: false, options: { temperature, num_predict: 600 }, messages }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = (await r.json()) as { message?: { content?: string } };
  return String(j?.message?.content || "");
}
function parseJson(txt: string): Record<string, unknown> | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}
const withDefaultNeg = (neg: string) => (neg.trim() ? `${neg.trim()}, ${DEFAULT_NEGATIVE}` : DEFAULT_NEGATIVE);

export async function enhanceImagePrompt(raw: string): Promise<EnhanceResult | null> {
  try {
    // 1) TASLAK
    const draftTxt = await ask([{ role: "system", content: DRAFT_SYS }, { role: "user", content: raw }], 0.7);
    const d = parseJson(draftTxt);
    if (d?.clarify && typeof d.clarify === "string" && String(d.clarify).trim()) {
      return { clarify: String(d.clarify).trim().slice(0, 300) };
    }
    let prompt = d?.prompt ? String(d.prompt).trim() : "";
    let negative = d?.negative ? String(d.negative).trim() : "";
    const complex = d?.complex === true;
    // JSON çıkmadıysa: düz metni taslak say
    if (!prompt) prompt = draftTxt.replace(/```[a-z]*|```/g, "").trim().slice(0, 1500);
    if (!prompt) return null;

    // 2) ELEŞTİR/DÜZELT (tek ek geçiş — yerel model bedava)
    try {
      const critTxt = await ask([
        { role: "system", content: CRITIC_SYS },
        { role: "user", content: `ORIGINAL REQUEST:\n${raw}\n\nCANDIDATE PROMPT:\n${prompt}\n\nCANDIDATE NEGATIVE:\n${negative || "(none)"}` },
      ], 0.4);
      const c = parseJson(critTxt);
      if (c?.prompt && String(c.prompt).trim()) {
        prompt = String(c.prompt).trim();
        if (c.negative) negative = String(c.negative).trim();
      }
    } catch { /* eleştiri başarısızsa taslak kullanılır */ }

    return { prompt: prompt.slice(0, 1800), negative: withDefaultNeg(negative), complex };
  } catch { return null; }
}
