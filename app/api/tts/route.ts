// Gerçekçi ses (TTS) proxy'si. İstemci her cümle için buraya POST atar, biz
// sesi alıp mp3 döneriz. Anahtarlar SUNUCUDA kalır (tarayıcıya sızmaz).
// Sıra: 1) OpenAI (NOVA_TTS_VOICE, vars. "nova" — kadın) → 2) fal.ai ElevenLabs
// (NOVA_FAL_TTS_VOICE, vars. "Rachel" — kadın). İkisi de yoksa/başarısızsa
// 501/502 → istemci tarayıcı sesine düşer.
export const runtime = "nodejs";

// Devre kesici: sağlayıcı kredi/limit hatası verdiyse 10 dk boyunca tekrar deneme
// (her cümlede boşuna bekleme olmasın). Son sebep kullanıcıya gösterilir.
const COOLDOWN_MS = 10 * 60_000;
const down: Record<"openai" | "fal", { until: number; why: string }> = {
  openai: { until: 0, why: "" },
  fal: { until: 0, why: "" },
};
function markDown(p: "openai" | "fal", status: number, body: string) {
  let why = `${status}`;
  if (status === 429 || /quota|credit|balance/i.test(body)) why = "kredi/kota bitti";
  else if (status === 403 && /top_up|locked/i.test(body)) why = "bakiye yüklenmeli";
  else if (status === 401) why = "anahtar geçersiz";
  down[p] = { until: Date.now() + COOLDOWN_MS, why };
}

async function openaiTts(text: string, voice: string): Promise<ArrayBuffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || Date.now() < down.openai.until) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.NOVA_TTS_MODEL || "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
        instructions:
          "Doğal, sıcak ve akıcı bir Türkçe konuşma tonuyla, insansı bir ritim ve tonlamayla konuş. Robotik olma.",
      }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 400);
      console.warn("[tts] openai", res.status, body.slice(0, 160));
      markDown("openai", res.status, body);
      return null;
    }
    return await res.arrayBuffer();
  } catch (e) {
    console.warn("[tts] openai hata", e instanceof Error ? e.message : e);
    return null;
  }
}

// fal.ai üzerinden ElevenLabs (Türkçe destekli, kadın sesi). fal.run senkron
// döner: { audio: { url } } → mp3'ü indirip aynen geçiriyoruz.
async function falTts(text: string): Promise<ArrayBuffer | null> {
  const key = process.env.FAL_KEY;
  if (!key || Date.now() < down.fal.until) return null;
  const model = process.env.NOVA_FAL_TTS_MODEL || "fal-ai/elevenlabs/tts/turbo-v2.5";
  const voice = process.env.NOVA_FAL_TTS_VOICE || "Rachel";
  try {
    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice,
        language_code: "tr",
        stability: 0.5,
        similarity_boost: 0.75,
        speed: 1,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { audio?: { url?: string }; detail?: unknown };
    if (!res.ok || !data?.audio?.url) {
      const body = JSON.stringify(data?.detail ?? data).slice(0, 400);
      console.warn("[tts] fal", res.status, body.slice(0, 160));
      if (!res.ok) markDown("fal", res.status, body);
      return null;
    }
    const a = await fetch(data.audio.url);
    if (!a.ok) return null;
    return await a.arrayBuffer();
  } catch (e) {
    console.warn("[tts] fal hata", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY && !process.env.FAL_KEY)
    return new Response("TTS anahtarı tanımlı değil", { status: 501 });

  let text = "";
  let voice = process.env.NOVA_TTS_VOICE || "nova"; // nova/shimmer (kadın), alloy, echo, onyx…
  try {
    const body = await req.json();
    if (typeof body?.text === "string") text = body.text;
    if (typeof body?.voice === "string" && body.voice) voice = body.voice;
  } catch {
    return new Response("Geçersiz istek", { status: 400 });
  }
  text = text.trim();
  if (!text) return new Response("Boş metin", { status: 400 });
  if (text.length > 4000) text = text.slice(0, 4000); // API sınırı

  const buf = (await openaiTts(text, voice)) ?? (await falTts(text));
  if (!buf) {
    // 503 + JSON: Cloudflare 502/504'ü kendi HTML sayfasıyla değiştiriyor, 503'ü geçirir
    const parts: string[] = [];
    if (process.env.OPENAI_API_KEY) parts.push(`OpenAI: ${down.openai.why || "yanıt yok"}`);
    if (process.env.FAL_KEY) parts.push(`fal: ${down.fal.why || "yanıt yok"}`);
    const retryIn = Math.max(0, Math.min(down.openai.until || Infinity, down.fal.until || Infinity) - Date.now());
    return Response.json(
      { error: "tts_unavailable", reason: parts.join(" · "), retryInMs: Number.isFinite(retryIn) ? retryIn : COOLDOWN_MS },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
