// Gerçekçi ses (OpenAI TTS) proxy'si. İstemci her cümle için buraya POST atar,
// biz OpenAI'dan sesi alıp mp3 döneriz. Anahtar SUNUCUDA kalır (tarayıcıya sızmaz).
// OPENAI_API_KEY tanımlı değilse 501 döner → istemci tarayıcı sesine düşer.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Response("OPENAI_API_KEY tanımlı değil", { status: 501 });

  let text = "";
  let voice = process.env.NOVA_TTS_VOICE || "nova"; // nova/shimmer/alloy/echo/onyx/fable…
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

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
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
      const err = await res.text().catch(() => "");
      return new Response(`OpenAI TTS hatası ${res.status}: ${err.slice(0, 300)}`, {
        status: 502,
      });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("TTS proxy hatası", { status: 502 });
  }
}
