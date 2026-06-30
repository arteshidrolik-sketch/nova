// Release & Store içerik üretimi (changelog, what's new TR/EN, ASO) ve red analizi.
import Anthropic from "@anthropic-ai/sdk";
import { loadTasks } from "@/lib/tasks/store";
import type { Release, ReleaseContent } from "./store";

const MODEL = process.env.NOVA_MODEL || "claude-opus-4-8";

export async function generateReleaseContent(
  rel: Release,
  notes: string,
): Promise<ReleaseContent> {
  const done = (await loadTasks())
    .filter((t) => t.status === "done")
    .slice(-15)
    .map((t) => `- ${t.title}`)
    .join("\n");

  const basis = [
    `Proje: ${rel.project}`,
    `Versiyon: ${rel.version}`,
    `Platform: ${rel.platform}`,
    notes ? `\nGeliştirici notları:\n${notes}` : "",
    done ? `\nSon tamamlanan işler:\n${done}` : "",
  ].join("\n");

  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `Sen Nova'nın RELEASE & STORE uzmanısın. Verilen sürüm bilgisinden
mağaza yayını için içerik üret. Mutlaka "release_content" aracını çağır.
ASO başlığı 30 karakteri geçmesin; anahtar kelimeler virgülle ayrılsın.`,
    tools: [
      {
        name: "release_content",
        description: "Sürüm yayın içeriğini üret.",
        input_schema: {
          type: "object",
          properties: {
            changelogUser: {
              type: "string",
              description: "Kullanıcıya dönük changelog (Markdown maddeler)",
            },
            changelogTech: {
              type: "string",
              description: "Teknik changelog (geliştiriciye dönük)",
            },
            whatsNewTr: {
              type: "string",
              description: "Mağaza 'Yenilikler' metni — Türkçe, kısa",
            },
            whatsNewEn: {
              type: "string",
              description: "Mağaza 'What's New' metni — İngilizce, kısa",
            },
            asoTitle: { type: "string", description: "ASO başlık (≤30 karakter)" },
            asoKeywords: {
              type: "string",
              description: "Virgülle ayrılmış anahtar kelimeler",
            },
            asoDescription: {
              type: "string",
              description: "Kısa mağaza açıklaması",
            },
          },
          required: ["changelogUser", "whatsNewTr", "whatsNewEn"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "release_content" },
    messages: [{ role: "user", content: basis }],
  });

  const tu = res.content.find((b) => b.type === "tool_use");
  const i = (tu?.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return {
    changelogUser: str(i.changelogUser),
    changelogTech: str(i.changelogTech),
    whatsNewTr: str(i.whatsNewTr),
    whatsNewEn: str(i.whatsNewEn),
    aso: {
      title: str(i.asoTitle),
      keywords: str(i.asoKeywords),
      description: str(i.asoDescription),
    },
    generatedAt: Date.now(),
  };
}

export async function analyzeRejection(
  rel: Release,
  reason: string,
): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `Sen Nova'nın RELEASE & STORE uzmanısın. App Store/Play red nedenini
analiz et: nedeni tek cümleyle özetle, ardından maddeler halinde somut düzeltme
adımları öner (Türkçe). Kısa ve uygulanabilir ol.`,
    messages: [
      {
        role: "user",
        content: `Proje: ${rel.project} ${rel.version} (${rel.platform})\n\nRed nedeni:\n${reason}`,
      },
    ],
  });
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}
