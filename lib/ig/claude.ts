// Claude çağrıları: günlük konsept üretimi + görsel kontrolü (baş konumu).
import Anthropic from "@anthropic-ai/sdk";
import { PERSONA } from "./persona";
import type { IgConcept } from "./store";

const MODEL = process.env.NOVA_MODEL || "claude-opus-4-8";

function text(res: Anthropic.Message): string {
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

function parseJson<T>(raw: string): T {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : raw).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(start > 0 ? body.slice(start) : body) as T;
}

// n adet yeni konsept. avoid: son kullanılan/reddedilen balonlar (tekrar etmesin).
export async function makeConcepts(
  n: number,
  avoid: string[],
  rejected: string[] = [],
): Promise<IgConcept[]> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: PERSONA,
    messages: [
      {
        role: "user",
        content: `${n} adet YENİ gönderi konsepti üret. Her biri farklı bir klişe olsun.

Daha önce kullanılanlar (TEKRARLAMA, benzerini de yazma):
${avoid.slice(-60).map((a) => `- ${a.replace(/\n/g, " ")}`).join("\n") || "(yok)"}
${rejected.length ? `\nYücel'in REDDETTİKLERİ (bu tarzdan uzak dur):\n${rejected.slice(-20).map((a) => `- ${a.replace(/\n/g, " ")}`).join("\n")}` : ""}

SADECE JSON dizi döndür:
[{"klise":"...","balon":"satır1\\nsatır2\\nsatır3","sahne":"English scene: where, who he begs from (that person/vehicle must be clearly visible), what he does with his cracked phone","aciklama":"...","hashtag":"#tek"}]`,
      },
    ],
  });
  const arr = parseJson<IgConcept[]>(text(res));
  return arr
    .filter((c) => c && c.balon && c.sahne)
    .slice(0, n)
    .map((c) => ({ ...c, hashtag: (c.hashtag || "").split(/\s+/)[0] || "" }));
}

export type ImageCheck = { ok: boolean; reason: string; headX: number; headY: number };

// Hazırlanmış 1080x1350 görseli kontrol eder: karakter doğru mu, yazı/logo var mı,
// balon kuyruğu için başının tepesi nerede.
export async function checkImage(jpeg: Buffer): Promise<ImageCheck> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
          },
          {
            type: "text",
            text: `This 1080x1350 image should show an old street beggar with long grey hair, grey beard and a brown fringed coat, begging someone for Instagram follows.
Return ONLY JSON: {"ok":true|false,"reason":"short Turkish reason if not ok","headX":int,"headY":int}
- ok=false if: the beggar is missing, there are 2+ similar beggars, the image contains readable text/letters/logos/brand names, or it is distorted/ugly.
- headX, headY: pixel coordinates of the TOP of the beggar's head (hair top, center) in this 1080x1350 image.`,
          },
        ],
      },
    ],
  });
  const j = parseJson<ImageCheck>(text(res));
  return {
    ok: !!j.ok,
    reason: j.reason || "",
    headX: Math.round(Number(j.headX) || 540),
    headY: Math.round(Number(j.headY) || 500),
  };
}
