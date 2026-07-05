// Obsidian kasasına (git köprüsü) otomatik "İş Günlüğü" yazar.
// NOVA_VAULT_PATH tanımlıysa aktif; değilse hiçbir şey yapmaz (yerelde sessiz).
// Bir proje görevi GO ile çalışınca ilgili projenin günlük notuna tarih
// başlığı altında bir satır ekler, commit + push eder (best-effort — hata
// kullanıcının işini asla bozmaz).
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function vaultRoot(): string | null {
  const p = process.env.NOVA_VAULT_PATH?.trim();
  return p || null;
}

// Klasör/dosya adı için güvenli hale getir
function safeName(s: string): string {
  return (
    String(s || "Genel")
      .replace(/[/\\:*?"<>|]/g, "-")
      .trim() || "Genel"
  );
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function oneLine(s: string, max = 300): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// Eşzamanlı push çakışmasını önlemek için sıraya al
let queue: Promise<void> = Promise.resolve();

export async function logToVault(input: {
  project: string; // proje adı (klasör + dosya adı)
  summary: string; // sade Türkçe "ne yapıldı"
  result?: string; // aksiyon çıktısı (kısa)
}): Promise<void> {
  const root = vaultRoot();
  if (!root) return; // köprü kapalı

  const proj = safeName(input.project);
  const dir = path.join(root, proj);
  const file = path.join(dir, `${proj} — İş Günlüğü.md`);

  const now = new Date();
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  try {
    await fs.mkdir(dir, { recursive: true });
    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      /* yeni dosya */
    }
    if (!content.trim()) {
      content =
        `---\ntur: is-gunlugu\nuygulama: ${proj}\n---\n\n` +
        `# 📔 ${proj} — İş Günlüğü\n\n` +
        `Nova'nın bu projede yaptığı işlerin otomatik kaydı. ` +
        `Her satır GO ile onaylanıp uygulanan bir aksiyondur.\n`;
    }
    const dayHeading = `## ${day}`;
    if (!content.includes(dayHeading)) {
      content = content.trimEnd() + `\n\n${dayHeading}\n`;
    }
    const line =
      `- **${time}** · ${oneLine(input.summary)}` +
      (input.result ? ` — _${oneLine(input.result, 160)}_` : "");
    content = content.trimEnd() + `\n${line}\n`;
    await fs.writeFile(file, content, "utf8");
  } catch {
    return; // dosya yazılamadıysa git'e hiç girme
  }

  // commit + push (sıralı, best-effort)
  const message = `günlük: ${proj} — ${oneLine(input.summary, 60)}`;
  queue = queue
    .then(() => gitSync(root, message))
    .catch(() => {});
  await queue;
}

async function gitSync(root: string, message: string): Promise<void> {
  const opts = {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 60000,
  };
  const msg = message.replace(/"/g, "'");
  try {
    await execAsync(`git add -A`, opts);
    await execAsync(`git commit -m "${msg}"`, opts);
  } catch {
    return; // commit'lenecek değişiklik yok → push'a gerek yok
  }
  try {
    await execAsync(`git pull --rebase`, opts);
  } catch {
    /* çakışma olsa da push denenecek */
  }
  try {
    await execAsync(`git push`, opts);
  } catch {
    /* push başarısızsa bir sonraki günlükte tekrar denenir */
  }
}
