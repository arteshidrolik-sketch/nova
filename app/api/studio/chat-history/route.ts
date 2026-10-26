// Admin sohbet hafızası: yazışma + seçili beceriler diskte tutulur (nova-data volume).
// Admin kapatılıp açılsa da "konuştuğumuzu hatırlar". Sunucu tarafı → her cihazdan aynı.
import path from "path";
import { promises as fs } from "fs";
import { SKILL_IDS } from "@/lib/studio/skills";

export const runtime = "nodejs";

const FILE = path.join(process.cwd(), "data", "studio-chat.json");

type Msg = { role: "user" | "assistant"; content: string };
type Store = { msgs: Msg[]; skills: string[] };

async function read(): Promise<Store> {
  try {
    const j = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<Store>;
    const msgs = Array.isArray(j.msgs) ? j.msgs.filter((m) => m && m.content && (m.role === "user" || m.role === "assistant")) : [];
    const skills = Array.isArray(j.skills) ? j.skills.filter((s) => SKILL_IDS.includes(s)) : [];
    return { msgs, skills };
  } catch { return { msgs: [], skills: [] }; }
}

export async function GET() {
  return Response.json(await read());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<Store>;
  const msgs = (Array.isArray(b.msgs) ? b.msgs : [])
    .filter((m) => m && m.content && (m.role === "user" || m.role === "assistant"))
    .slice(-200); // son 200 mesaj — dosya sınırsız büyümesin
  const skills = (Array.isArray(b.skills) ? b.skills : []).filter((s) => SKILL_IDS.includes(s));
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ msgs, skills }));
  return Response.json({ ok: true });
}
