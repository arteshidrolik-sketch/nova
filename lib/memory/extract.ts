// Hafıza ajanı: bir konuşma alışverişinden kalıcı olarak hatırlanmaya değer
// bilgi olup olmadığına karar verir (tool-use ile).
import type Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Sen bir HAFIZA ajanısın. Verilen kullanıcı-asistan alışverişine bak ve
GELECEKTEKI konuşmalarda işe yarayacak KALICI bir bilgi olup olmadığına karar ver.

Kalıcı sayılır: kullanıcının tercihleri, kararları, üzerinde çalıştığı projeler,
kişisel/iş bağlamı, tekrar lazım olacak teknik seçimler.
Kalıcı SAYILMAZ: tek seferlik sorular, genel bilgi cevapları, geçici detaylar.

Mutlaka "save_memory" aracını çağır. Hatırlanacak bir şey yoksa remember=false ver.`;

export async function extractMemory(
  client: Anthropic,
  model: string,
  userText: string,
  assistantText: string,
): Promise<{ remember: boolean; summary?: string; tags?: string[] }> {
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM,
      tools: [
        {
          name: "save_memory",
          description:
            "Bu alışverişten kalıcı bir not çıkar (veya hatırlanacak bir şey yoksa remember=false).",
          input_schema: {
            type: "object",
            properties: {
              remember: {
                type: "boolean",
                description: "Kalıcı olarak hatırlanmaya değer mi?",
              },
              summary: {
                type: "string",
                description:
                  "Hatırlanacak bilgi, tek cümle (remember=true ise zorunlu).",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Konuyu özetleyen 1-4 kısa etiket.",
              },
            },
            required: ["remember"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_memory" },
      messages: [
        {
          role: "user",
          content: `Kullanıcı: ${userText}\n\nAsistan: ${assistantText}`,
        },
      ],
    });

    const tu = res.content.find((b) => b.type === "tool_use");
    const input = tu?.input as
      | { remember?: unknown; summary?: unknown; tags?: unknown }
      | undefined;

    const remember = input?.remember === true;
    const summary =
      typeof input?.summary === "string" ? input.summary : undefined;
    const tags = Array.isArray(input?.tags)
      ? (input!.tags as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : [];

    if (!remember || !summary) return { remember: false };
    return { remember: true, summary, tags };
  } catch {
    return { remember: false };
  }
}
