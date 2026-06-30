import Anthropic from "@anthropic-ai/sdk";
import { extractMemory } from "@/lib/memory/extract";
import { loadMemories, saveMemory } from "@/lib/memory/store";

export const runtime = "nodejs";

const MEMORY_MODEL =
  process.env.NOVA_MEMORY_MODEL ||
  process.env.NOVA_ROUTER_MODEL ||
  process.env.NOVA_MODEL ||
  "claude-opus-4-8";

// Kaydedilmiş anıları listele (test/inceleme için)
export async function GET() {
  const memories = await loadMemories();
  return Response.json({ count: memories.length, memories });
}

// Bir alışverişten kalıcı not çıkar ve kaydet (istemci cevap bitince çağırır)
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ saved: false, reason: "no_api_key" });
  }

  let userText = "";
  let assistantText = "";
  try {
    const body = await req.json();
    userText = String(body?.userText ?? "");
    assistantText = String(body?.assistantText ?? "");
  } catch {
    return Response.json({ saved: false, reason: "bad_request" }, { status: 400 });
  }

  if (!userText || !assistantText) {
    return Response.json({ saved: false, reason: "empty" });
  }

  const client = new Anthropic();
  const result = await extractMemory(
    client,
    MEMORY_MODEL,
    userText,
    assistantText,
  );

  if (!result.remember || !result.summary) {
    return Response.json({ saved: false, reason: "not_worth_remembering" });
  }

  const mem = await saveMemory({ summary: result.summary, tags: result.tags });
  return Response.json({ saved: true, memory: mem });
}
