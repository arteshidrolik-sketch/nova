// Orkestratör: kullanıcı mesajına bakıp hangi uzman ajanın yanıt vereceğine
// Claude'un tool-use özelliğiyle karar verir.
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_KEYS, isAgentKey, type AgentKey } from "./meta";
import { ROUTER_DESCRIPTIONS } from "./prompts";

type ChatMessage = { role: "user" | "assistant"; content: string };

const ROUTER_SYSTEM = `Sen bir orkestratörsün. Kullanıcının SON mesajına ve sohbet
bağlamına bakarak işi yapacak en uygun uzman ajanı seçeceksin.

Ajanlar:
${AGENT_KEYS.map((k) => `- ${k}: ${ROUTER_DESCRIPTIONS[k]}`).join("\n")}

Kurallar:
- Mutlaka "select_agent" aracını çağır, başka bir şey yazma.
- Net bir uzmanlık yoksa "general" seç.`;

export async function selectAgent(
  client: Anthropic,
  model: string,
  messages: ChatMessage[],
): Promise<AgentKey> {
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: ROUTER_SYSTEM,
      tools: [
        {
          name: "select_agent",
          description: "Bu mesaj için en uygun uzman ajanı seç.",
          input_schema: {
            type: "object",
            properties: {
              agent: {
                type: "string",
                enum: AGENT_KEYS,
                description: "Seçilen uzman ajanın anahtarı",
              },
              reason: {
                type: "string",
                description: "Tek cümlelik kısa gerekçe",
              },
            },
            required: ["agent"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "select_agent" },
      messages,
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    const picked = (toolUse?.input as { agent?: unknown } | undefined)?.agent;
    return isAgentKey(picked) ? picked : "general";
  } catch {
    // Router başarısız olursa sohbeti bloklamadan genel ajana düş.
    return "general";
  }
}
