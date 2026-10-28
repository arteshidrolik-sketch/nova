// Anatomi denetçisi: üretilen görseli SANSÜRSÜZ görü modeliyle inceler, insan
// vücudu bütünlüğünü kontrol eder. İKİ AŞAMALI inceleme (7B model küçük elleri
// göremediği için kritik):
//   1) TAM görsel → kaba/büyük hatalar (fazla uzuv, iki gövde, bozuk yüz).
//   2) PARÇA PARÇA (tile) → her parçayı büyütüp denetler, böylece ELLER büyük
//      görünür ve ince parmak kusurları (kaynaşma/fazla parmak) yakalanır.
// Kusur bulursa negatif prompt'a eklenecek terimleri döndürür; görsel route'u
// bir döngüde kullanır (üret→denetle→kusurluysa yeniden üret). Model çıplak
// içeriği de reddetmeden denetler (abliterate). Pod'da test edildi: tam görsel
// kaçıran kusuru parça inceleme yakaladı.
import { ollamaHasModel, ollamaPull } from "@/lib/brain/ollama";

const OLLAMA = "http://127.0.0.1:11434";
const VL_MODEL = process.env.NOVA_ANATOMY_MODEL || "huihui_ai/qwen2.5-vl-abliterated:7b";

// Tam görsel: kaba/belirgin hatalar.
const FULL_SYS =
  "You are a strict anatomy inspector for AI images. Judge ONLY human body integrity (ignore style/nudity/background). Look for CLEAR/OBVIOUS defects: extra or missing or merged limbs, two heads, duplicated/merged bodies, grossly wrong proportions, a melted or badly distorted face, limbs bending the wrong way, body parts melting into each other. Do NOT fail minor softness. If a hybrid creature (centaur etc.), judge only human parts. If no person, ok=true.\n" +
  'Answer ONLY JSON: {"ok": true|false, "defects": ["short"], "negative_add": "comma-separated english negatives"}.';

// Tek parça (büyütülmüş kırpma): esas olarak ELLER.
const TILE_SYS =
  "You are inspecting a CROPPED, zoomed-in piece of a larger AI image. Look ONLY for human HANDS and limbs in this crop. If you see a hand, examine it closely and COUNT the fingers (thumb + 4). Report a problem if: not exactly 5 natural fingers, fused/merged fingers, extra or missing fingers, elongated/clawed/melted/deformed hand or fingers, malformed thumb, or a deformed/extra/missing limb. If there is no hand or limb, or it looks correct, ok=true.\n" +
  'Answer ONLY JSON: {"ok": true|false, "defects": ["short"]}.';

export type AnatomyVerdict = { ok: boolean; defects: string[]; negativeAdd: string };

export async function ensureAnatomyModel(onLog?: (s: string) => void): Promise<void> {
  if (await ollamaHasModel(OLLAMA, VL_MODEL)) return;
  onLog?.("Anatomi denetçisi (görü modeli) ilk kez kuruluyor…");
  await ollamaPull(OLLAMA, VL_MODEL);
}

type Raw = { ok?: unknown; defects?: unknown; negative_add?: unknown };
async function askVL(sys: string, b64: string): Promise<{ ok: boolean; defects: string[]; negAdd: string } | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: VL_MODEL, stream: false, options: { temperature: 0.2, num_predict: 250 },
        messages: [{ role: "system", content: sys }, { role: "user", content: "Inspect and answer with ONLY the JSON.", images: [b64] }] }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return null;
    const txt = String(((await r.json()) as { message?: { content?: string } })?.message?.content || "");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Raw;
    return { ok: p.ok === true, defects: Array.isArray(p.defects) ? p.defects.map(String).slice(0, 6) : [], negAdd: String(p.negative_add || "").slice(0, 200) };
  } catch { return null; }
}

// İki aşamalı denetim. image: PNG buffer.
export async function inspectAnatomy(image: Buffer): Promise<AnatomyVerdict | null> {
  // 1) Tam görsel — kaba hatalar
  const full = await askVL(FULL_SYS, image.toString("base64"));
  if (!full) return null;
  if (!full.ok) return { ok: false, defects: full.defects, negativeAdd: full.negAdd || "bad anatomy, extra limbs, deformed body" };
  const okVerdict: AnatomyVerdict = { ok: true, defects: [], negativeAdd: "" }; // tam görsel temiz; parça incelenemezse bunu dön

  // 2) Parça parça — eller/ince kusurlar (büyütülmüş kırpmalar)
  let sharp: typeof import("sharp");
  try { sharp = (await import("sharp")).default as unknown as typeof import("sharp"); }
  catch { return okVerdict; } // sharp yoksa sadece tam görsel sonucu
  let W = 1024, H = 1024;
  try { const meta = await sharp(image).metadata(); W = meta.width || 1024; H = meta.height || 1024; } catch { return okVerdict; }

  const cols = 2, rows = 3, ov = 0.12; // portre figürler için 2 geniş × 3 uzun, %12 bindirme
  const defects = new Set<string>();
  let negAdd = "";
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const tw = Math.floor(W / cols), th = Math.floor(H / rows);
      const left = Math.max(0, Math.floor(cx * tw - tw * ov));
      const top = Math.max(0, Math.floor(ry * th - th * ov));
      const w = Math.min(W - left, Math.floor(tw * (1 + 2 * ov)));
      const h = Math.min(H - top, Math.floor(th * (1 + 2 * ov)));
      if (w < 16 || h < 16) continue;
      let tileB64: string;
      try { tileB64 = (await sharp(image).extract({ left, top, width: w, height: h }).resize(1024, 1024, { fit: "inside" }).png().toBuffer()).toString("base64"); }
      catch { continue; }
      const v = await askVL(TILE_SYS, tileB64);
      if (v && !v.ok) { v.defects.forEach((d) => defects.add(d)); if (v.negAdd) negAdd = v.negAdd; }
    }
  }
  if (defects.size) {
    return { ok: false, defects: [...defects].slice(0, 8), negativeAdd: negAdd || "deformed hands, fused fingers, extra fingers, mutated hands, long fingers, bad hands" };
  }
  return { ok: true, defects: [], negativeAdd: "" };
}
