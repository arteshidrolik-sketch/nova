// Anatomi denetçisi: üretilen görseli SANSÜRSÜZ görü modeliyle inceler, insan
// vücudu bütünlüğünü (el/parmak/uzuv/yüz/oran/birleşim) kontrol eder. Kusur
// bulursa negatif prompt'a eklenecek terimleri döndürür. Görsel route'u bunu
// bir döngüde kullanır: üret → denetle → kusurluysa negatifi güçlendir + yeniden
// üret → düzelene (ya da deneme hakkı bitene) kadar. Model çıplak içeriği de
// reddetmeden denetler (abliterate). "Eğitim" = aşağıdaki ayrıntılı kontrol listesi.
import { ollamaHasModel, ollamaPull } from "@/lib/brain/ollama";

const OLLAMA = "http://127.0.0.1:11434";
const VL_MODEL = process.env.NOVA_ANATOMY_MODEL || "huihui_ai/qwen2.5-vl-abliterated:7b";

const SYS =
  "You are a STRICT ANATOMY INSPECTOR for AI-generated images. Judge ONLY human body integrity — ignore style, mood, background, clothing, and whether content is explicit/nude. Your single job: are there CLEAR anatomical errors?\n" +
  "AI models almost always get HANDS wrong, so examine every hand with suspicion — mentally zoom in and COUNT the fingers one by one.\n" +
  "Mark ok=FALSE if you see any CLEAR/OBVIOUS defect:\n" +
  "- HANDS: not exactly 5 fingers, fused/merged fingers, extra or missing fingers, clearly claw-like / elongated / melted / malformed hands, a malformed thumb, or an obviously wrong number of hands.\n" +
  "- LIMBS: extra, missing, merged, or floating arms/legs; joints bending the wrong way; limb attached at the wrong place.\n" +
  "- BODY: two heads, duplicated/merged bodies, grossly wrong proportions.\n" +
  "- FACE: missing/extra/misplaced eyes, nose or mouth; melted or badly distorted face.\n" +
  "- JOINS: body parts melting or fusing into each other.\n" +
  "Do NOT fail an image for minor softness, style, or slightly imperfect but plausible hands — only CLEAR, obvious anatomical errors.\n" +
  "If the subject is intentionally a hybrid/mythological creature (centaur, mermaid, etc.), judge only the HUMAN parts and accept the intended animal parts.\n" +
  "If there is no person/human in the image, ok=true.\n" +
  'Answer with ONLY this JSON, nothing else: {"ok": true|false, "defects": ["short specific defect", ...], "negative_add": "comma-separated english terms to add to the image negative-prompt to prevent these defects (e.g. extra fingers, fused fingers, deformed hands, mutated hands, long fingers)"}.';

export type AnatomyVerdict = { ok: boolean; defects: string[]; negativeAdd: string };

// Görü modeli kurulu mu? (ilk kullanımda indirilir)
export async function ensureAnatomyModel(onLog?: (s: string) => void): Promise<void> {
  if (await ollamaHasModel(OLLAMA, VL_MODEL)) return;
  onLog?.("Anatomi denetçisi (görü modeli) ilk kez kuruluyor…");
  await ollamaPull(OLLAMA, VL_MODEL);
}

// Tek görseli denetle. imageBase64: ham base64 (data: öneki olmadan).
export async function inspectAnatomy(imageBase64: string): Promise<AnatomyVerdict | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VL_MODEL, stream: false, options: { temperature: 0.2, num_predict: 400 },
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: "Inspect this image's human anatomy and answer with the JSON.", images: [imageBase64] },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { message?: { content?: string } };
    const txt = String(j?.message?.content || "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as { ok?: unknown; defects?: unknown; negative_add?: unknown };
    return {
      ok: p.ok === true,
      defects: Array.isArray(p.defects) ? p.defects.map(String).slice(0, 8) : [],
      negativeAdd: String(p.negative_add || "").slice(0, 300),
    };
  } catch { return null; }
}
