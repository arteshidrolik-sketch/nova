// Loop tanımları. Her loop bir iş akışını çalıştırır ve bir özet (ve isteğe
// bağlı bir görev) üretir.
import Anthropic from "@anthropic-ai/sdk";
import { loadTasks, createTask } from "@/lib/tasks/store";
import { loadMemories } from "@/lib/memory/store";
import { runGithubLookup } from "@/lib/tools/github";

const MODEL = process.env.NOVA_MODEL || "claude-opus-4-8";

async function claudeText(system: string, user: string): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

export type LoopRunResult = { summary: string; taskId?: string };

export type LoopDef = {
  id: string;
  name: string;
  description: string;
  schedule: string; // cron
  scheduleLabel: string; // okunabilir
  run: () => Promise<LoopRunResult>;
};

export const LOOPS: LoopDef[] = [
  {
    id: "weekly-briefing",
    name: "Haftalık Proje Brifingi",
    description:
      "Son görevleri, hafıza notlarını ve (NOVA_BRIEF_REPO ayarlıysa) son commitleri toplayıp kısa bir brifing üretir.",
    schedule: "0 8 * * 1",
    scheduleLabel: "Her Pazartesi 08:00",
    run: async () => {
      const tasks = (await loadTasks()).slice(-10);
      const memories = (await loadMemories()).slice(-10);

      let commits = "";
      const repo = process.env.NOVA_BRIEF_REPO; // "owner/repo"
      if (repo && repo.includes("/")) {
        const [owner, name] = repo.split("/");
        commits = await runGithubLookup({
          owner,
          repo: name,
          kind: "commits",
          limit: 5,
        });
      }

      const ctx = [
        `## Görevler (${tasks.length})`,
        tasks.map((t) => `- [${t.status}] ${t.title}`).join("\n") || "(yok)",
        ``,
        `## Notlar (hafıza)`,
        memories.map((m) => `- ${m.summary}`).join("\n") || "(yok)",
        repo ? `\n## ${repo} son commitler\n${commits}` : "",
      ].join("\n");

      const summary = await claudeText(
        `Sen Nova'nın brifing üreticisisin. Verilen verilerden KISA, maddeler
halinde Türkçe bir haftalık brifing yaz: "Öne çıkanlar", "Bekleyen işler",
"Öneriler" başlıklarıyla. Veri azsa kısa tut, uydurma.`,
        ctx,
      );

      return { summary: summary || "Brifing üretilemedi (yeterli veri yok)." };
    },
  },

  {
    id: "changelog-draft",
    name: "Changelog / Sürüm Notu Taslağı",
    description:
      "Tamamlanan görevlerden bir sürüm notu taslağı üretir ve GO-onaylı bir 'dosya yaz' görevi olarak önerir.",
    schedule: "0 9 * * 5",
    scheduleLabel: "Her Cuma 09:00",
    run: async () => {
      const done = (await loadTasks())
        .filter((t) => t.status === "done")
        .slice(-15);
      const basis =
        done.map((t) => `- ${t.title}`).join("\n") ||
        "(Henüz tamamlanan görev yok — kısa, temsili bir örnek changelog üret.)";

      const draft = await claudeText(
        `Sen Nova'nın sürüm notu yazarısın. Verilen tamamlanan işlerden KISA bir
changelog taslağı yaz. Markdown, "## Sürüm Notları" başlığıyla, kullanıcıya
dönük maddeler. SADECE changelog metnini ver.`,
        basis,
      );

      const task = await createTask({
        agent: "releaseStore",
        actionType: "write_file",
        title: "Dosya yaz: workspace/changelog-taslak.md",
        payload: { path: "changelog-taslak.md", content: draft },
        dangerous: true,
      });

      return {
        summary: `Sürüm notu taslağı üretildi ve GO-onaylı görev olarak önerildi (görev ${task.id.slice(
          0,
          8,
        )}). "Görevler" ekranından GO ile workspace'e yazabilirsin.\n\n${draft}`,
        taskId: task.id,
      };
    },
  },
];

export function getLoop(id: string): LoopDef | undefined {
  return LOOPS.find((l) => l.id === id);
}
