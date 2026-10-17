// Kod uzmanı işe başlamadan önce proje kopyasını GitHub ile eşitler: uzak dalı çeker,
// yerel değişiklik yoksa ve yalnız gerideyse ileri sarar (fast-forward). Yerelde
// commit'lenmemiş değişiklik ya da ayrışma varsa DOKUNMAZ, yalnız durumu bildirir.
// Amaç: uzmanın canlıda olmayan eski kodu "güncel" sanmaması.
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);
const git = (cwd: string, args: string[]) =>
  run("git", args, { cwd, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).then((r) => r.stdout.trim());

export async function syncRepo(cwd: string): Promise<string> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch { return ""; } // git deposu değil
  try {
    await git(cwd, ["fetch", "-q", "origin"]);
  } catch (e) {
    return `⚠️ GitHub'dan güncelleme çekilemedi (${e instanceof Error ? e.message.split("\n").find((l) => l.startsWith("fatal")) ?? "hata" : "hata"}). Kopya eski olabilir; durum sorularında bunu belirt.`;
  }
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "main");
  const upstream = `origin/${branch}`;
  const [behind, ahead] = (await git(cwd, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]).catch(() => "0\t0")).split(/\s+/).map(Number);
  const dirty = (await git(cwd, ["status", "--porcelain"]).catch(() => "")).length > 0;
  let note = "";
  if (behind > 0 && ahead === 0 && !dirty) {
    await git(cwd, ["merge", "--ff-only", "-q", upstream]).catch(() => {});
    note = `GitHub'daki ${behind} yeni commit çekildi (ileri sarıldı). `;
  } else if (behind > 0) {
    note = `⚠️ Kopya GitHub'ın ${behind} commit gerisinde ama ${dirty ? "yerelde commit'lenmemiş değişiklik" : `${ahead} yerel commit`} olduğu için otomatik güncellenmedi. `;
  } else if (ahead > 0) {
    note = `Not: GitHub'a gönderilmemiş ${ahead} yerel commit var (canlıda DEĞİL). `;
  }
  const head = await git(cwd, ["log", "--oneline", "-1"]).catch(() => "?");
  const remote = await git(cwd, ["log", "--oneline", "-1", upstream]).catch(() => "?");
  return `${note}Proje kopyası: ${branch} @ ${head} · GitHub ${upstream} @ ${remote}${dirty ? " · yerelde commit'lenmemiş değişiklik var" : ""}.`;
}
