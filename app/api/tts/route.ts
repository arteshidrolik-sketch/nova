// Gerçekçi ses (TTS) proxy'si. İstemci her cümle için buraya POST atar, biz
// sesi alıp mp3 döneriz. Anahtarlar SUNUCUDA kalır (tarayıcıya sızmaz).
// Sıra: 1) OpenAI (NOVA_TTS_VOICE, vars. "nova" — kadın) → 2) fal.ai ElevenLabs
// (NOVA_FAL_TTS_VOICE, vars. "Rachel" — kadın). İkisi de yoksa/başarısızsa
// 501/502 → istemci tarayıcı sesine düşer.
export const runtime = "nodejs";

async function openaiTts(text: string, voice: string): Promise<ArrayBuffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
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
      console.warn("[tts] openai", res.status, (await res.text().catch(() => "")).slice(0, 160));
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
  if (!key) return null;
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
      console.warn("[tts] fal", res.status, JSON.stringify(data?.detail ?? data).slice(0, 160));
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
  if (!buf) return new Response("TTS sağlayıcıları yanıt vermedi (kredi/limit?)", { status: 502 });
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
