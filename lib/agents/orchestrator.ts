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
  prevAgent?: string,
): Promise<AgentKey> {
  // Yönlendirme yalnızca SON mesaja + yakın bağlama bakar. Tüm geçmişi (büyük
  // sohbetlerde 35k+ token) göndermek gereksiz gecikme + maliyet demek → son
  // birkaç mesajla sınırla. prevAgent zaten sürekliliği ayrıca taşıyor.
  // API mesajlarda ekstra alan (agent/attachments) kabul etmez → sadece role+content bırak
  const clean = messages.slice(-8).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: typeof m.content === "string" ? m.content : "",
  }));
  // İlk mesaj "user" olmalı (API kuralı) — baştaki asistan mesajlarını at
  while (clean.length > 1 && clean[0].role !== "user") clean.shift();

  // Süreklilik: önceki yanıt bir ajandan geldiyse, kısa devam/onay mesajlarında
  // (evet, sen yap, güncelle, devam et…) AYNI ajanda kal — iş ortada bölünmesin.
  const system =
    prevAgent && isAgentKey(prevAgent)
      ? ROUTER_SYSTEM +
        `\n\nÖnceki yanıt "${prevAgent}" ajanındandı ve iş sürüyor olabilir. ` +
        `Kullanıcının yeni mesajı aynı işin DEVAMI ya da kısa bir onay/yönlendirme ise ` +
        `("evet", "sen yap", "sen güncelle", "devam et", "olur", "tamam" gibi) MUTLAKA aynı ajanı ("${prevAgent}") seç. ` +
        `Sadece açıkça FARKLI bir uzmanlık gerektiren yeni bir iş başlıyorsa ajan değiştir.`
      : ROUTER_SYSTEM;

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system,
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
      messages: clean,
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    const picked = (toolUse?.input as { agent?: unknown } | undefined)?.agent;
    return isAgentKey(picked) ? picked : "general";
  } catch {
    // Router başarısız olursa sohbeti bloklamadan genel ajana düş.
    return "general";
  }
}
