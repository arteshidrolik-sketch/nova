import Anthropic from "@anthropic-ai/sdk";
import { runAllEvals } from "@/lib/evals/run";
import { loadEvals, saveEvals } from "@/lib/evals/store";
import { appendAudit } from "@/lib/audit/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return Response.json({ run: await loadEvals() });
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY yok" }, { status: 500 });
  }
  const client = new Anthropic();
  const run = await runAllEvals(client);
  await saveEvals(run);
  appendAudit({
    agent: "kullanıcı",
    action: "eval_run",
    tier: "control",
    summary: `Eval çalıştırıldı — yönlendirme ${run.routingScore}, injection ${run.injectionScore}`,
    ok: run.pct >= 80,
    result: `toplam ${run.total} (%${run.pct})`,
  }).catch(() => {});
  return Response.json({ run });
}
