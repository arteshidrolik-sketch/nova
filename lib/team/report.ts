// Gün sonu ilerleme raporu: her gün 18:00 (İstanbul) müdür, son rapordan bu yana
// hareket olan her proje için kısa bir rapor yazar ve projenin sohbetine ekler.
// Hareketsiz projelere rapor yazılmaz (gürültü olmasın).
import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import { loadConversations, updateConversation } from "@/lib/conversations/store";
import { getSkillsForTeamRole } from "@/lib/skills/store";
import { recordUsage } from "@/lib/budget/store";
import { recordProjectUsage } from "./usage";
import { ensureTeamSkills } from "./skills";
import { TEAM_META } from "./roles";
import { readTeamLog, summarizeTeamLog } from "./log";

const FILE = path.join(process.cwd(), "data", "team-reports.json");
type State = { lastDay?: string; convs: Record<string, { count: number; ts: number }> };

async function loadState(): Promise<State> {
  try { const d = JSON.parse(await fs.readFile(FILE, "utf8")); return { convs: {}, ...d }; } catch { return { convs: {} }; }
}
async function saveState(s: State) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
}

// İstanbul saatine göre "YYYY-MM-DD" ve "HH:MM"
export function istanbulNow(d = new Date()): { day: string; hm: string } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}` };
}

let running = false;
// Zamanlayıcı her dakika çağırır; 18:00'de ve bugün henüz yapılmadıysa çalışır.
export async function maybeRunDailyReports(): Promise<void> {
  const { day, hm } = istanbulNow();
  const at = process.env.NOVA_REPORT_TIME || "18:00";
  if (hm !== at || running) return;
  const st = await loadState();
  if (st.lastDay === day) return;
  running = true;
  try { await runDailyReports(day); } finally { running = false; }
}

export async function runDailyReports(day = istanbulNow().day, markDay = true): Promise<{ written: number; skipped: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { written: 0, skipped: 0 };
  await ensureTeamSkills();
  const st = await loadState();
  const skills = await getSkillsForTeamRole("manager");
  const client = new Anthropic();
  const model = process.env.NOVA_REPORT_MODEL || "claude-sonnet-5"; // özet işi: Sonnet yeterli, ucuz
  const all = await loadConversations();
  let written = 0, skipped = 0;
  for (const c of all) {
    if (c.forcedAgent) { skipped++; continue; } // kilitli/özel sohbetler ekip projesi değil
    const msgs = c.messages || [];
    // İlk kez raporlanan proje: yalnız bugün güncellendiyse son 14 mesaj (eski geçmiş "bugün" sayılmasın)
    let base = st.convs[c.id]?.count;
    if (base === undefined) {
      if (istanbulNow(new Date(c.updatedAt)).day !== day) { st.convs[c.id] = { count: msgs.length, ts: Date.now() }; skipped++; continue; }
      base = Math.max(0, msgs.length - 14);
    }
    // önceki raporlar hariç yeni kullanıcı/asistan mesajları
    const fresh = msgs.slice(Math.min(base, msgs.length)).filter((m) => !String(m.content).startsWith("📋 **Gün sonu"));
    if (!fresh.some((m) => m.role === "user")) { skipped++; continue; }
    const transcript = fresh
      .map((m) => `${m.role === "user" ? "KULLANICI" : "EKİP"}: ${String(m.content).slice(0, 4000)}`)
      .join("\n\n").slice(-40000);
    try {
      const res = await client.messages.create({
        model, max_tokens: 2500,
        system:
          `Sen "${c.title}" projesinin proje müdürüsün. Bugünün (${day}) çalışma kaydından kısa bir GÜN SONU İLERLEME RAPORU yaz. ` +
          `Yalnız kayıtta olanı yaz, abartma, olmayan işi ekleme. Dosya/görsel linklerini aynen aktar.` +
          (skills.length ? "\n\n" + skills.map((s) => `### ${s.name}\n${s.content}`).join("\n\n") : ""),
        messages: [{ role: "user", content: `Bugünün kaydı:\n\n${transcript}` }],
      });
      if (res.usage) recordUsage(model, res.usage.input_tokens ?? 0, res.usage.output_tokens ?? 0, { read: (res.usage as { cache_read_input_tokens?: number | null }).cache_read_input_tokens, write: (res.usage as { cache_creation_input_tokens?: number | null }).cache_creation_input_tokens }).catch(() => {});
      recordProjectUsage(c.id, "manager", model, res.usage);
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
      if (!text) { skipped++; continue; }
      const audit = summarizeTeamLog(await readTeamLog({ projectId: c.id, day }));
      const dateTr = new Date(`${day}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
      const report = {
        role: "assistant" as const,
        content: `📋 **Gün sonu ilerleme raporu — ${dateTr}**\n\n${text}${audit ? `\n\n${audit}` : ""}`,
        agentName: TEAM_META.manager.name, agentEmoji: "👔", agentColor: TEAM_META.manager.color, model,
      };
      // yarış: rapor yazılırken yeni mesaj gelmiş olabilir → güncel listeye ekle
      const latest = (await loadConversations()).find((x) => x.id === c.id);
      const next = [...(latest?.messages ?? msgs), report];
      await updateConversation(c.id, { messages: next as never });
      st.convs[c.id] = { count: next.length, ts: Date.now() };
      written++;
    } catch (e) {
      console.warn("[rapor]", c.title, e instanceof Error ? e.message : e);
      skipped++;
    }
  }
  if (markDay) st.lastDay = day; // elle tetiklemede 18:00 raporu yine çalışsın
  await saveState(st);
  console.log(`[rapor] ${day}: ${written} rapor yazıldı, ${skipped} proje atlandı`);
  return { written, skipped };
}
