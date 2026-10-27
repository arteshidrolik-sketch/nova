// Çevrimdışı beyin: internet yokken Claude yerine yerel Ollama modeli.
// Aşama 1 = yalnızca sohbet (bulut araçları internet gerektirir, atlanır).
import type Anthropic from "@anthropic-ai/sdk";

// Claude API'ye ağ üzerinden ulaşılabiliyor mu? (kısa timeout'lu hafif kontrol).
// Herhangi bir HTTP yanıtı gelirse "çevrimiçi"; hiç yanıt gelmezse (DNS/ağ yok) çevrimdışı.
export async function claudeReachable(timeoutMs = 3500): Promise<boolean> {
  const key = process.env.ANTHROPIC_API_KEY;
  try {
    await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: key
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true; // yanıt geldi (status ne olursa olsun) → ağ var
  } catch {
    return false; // timeout / DNS / bağlantı yok → çevrimdışı
  }
}

type OllamaMsg = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

// Model pod'da kurulu mu? (görü modeli ilk kullanımda indirilecek)
export async function ollamaHasModel(baseUrl: string, model: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { models?: { name: string }[] };
    const want = model.includes(":") ? model : `${model}:latest`;
    return (j.models ?? []).some((m) => m.name === model || m.name === want);
  } catch { return false; }
}

// Modeli indir (akışı sonuna kadar oku; ilk görsel isteğinde bir kez, /workspace'e kalıcı iner).
export async function ollamaPull(baseUrl: string, model: string): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pull`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: AbortSignal.timeout(540000), // büyük model: cömert süre
  });
  if (!res.ok || !res.body) throw new Error(`Görü modeli indirilemedi (HTTP ${res.status})`);
  const reader = res.body.getReader();
  for (;;) { const { done } = await reader.read(); if (done) break; } // bitene kadar bekle
}

// Anthropic içerik bloklarından düz metni çıkar (Ollama sadece metin ister).
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const bb = b as { type?: string; text?: string };
        return bb.type === "text" && typeof bb.text === "string" ? bb.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function toOllamaMessages(
  system: string,
  convo: Anthropic.MessageParam[],
): OllamaMsg[] {
  const msgs: OllamaMsg[] = [{ role: "system", content: system }];
  for (const m of convo) {
    const role: "user" | "assistant" =
      m.role === "assistant" ? "assistant" : "user";
    const text = blockText(m.content).trim();
    if (text) msgs.push({ role, content: text });
  }
  return msgs;
}

// Tek seferlik (akışsız) sohbet — tüm yanıtı metin olarak döndür. Ajan döngüleri için.
export async function ollamaChatOnce(
  baseUrl: string, model: string, messages: OllamaMsg[],
  opts: { temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: opts.temperature ?? 0.4 } }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  if (!res.ok) throw new Error(`Ollama yanıt vermedi (HTTP ${res.status}).`);
  const j = (await res.json()) as { message?: { content?: string } };
  return String(j?.message?.content ?? "");
}

// Ollama /api/chat akışını oku, her metin parçasını onChunk ile ver.
export async function ollamaChatStream(
  baseUrl: string,
  model: string,
  messages: OllamaMsg[],
  onChunk: (t: string) => void,
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(
      `Ollama yanıt vermedi (HTTP ${res.status}). 'ollama serve' çalışıyor ve model kurulu mu?`,
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string } };
        const t = j?.message?.content;
        if (typeof t === "string" && t) onChunk(t);
      } catch {
        /* yarım satır — atla */
      }
    }
  }
}
