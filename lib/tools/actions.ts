// Aksiyonlar (yazma/komut). Model aracı çağırır; sunucu HEMEN execute() çalıştırır
// (GO onayı kaldırıldı) ve sonucu Görevler'e "tamamlandı" olarak kaydeder.
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import { resolveIn } from "./projectFiles";

const execAsync = promisify(exec);
type Payload = Record<string, unknown>;

// Özet yardımcıları — kullanıcının "ne yapılacak?"ı anlaması için sade Türkçe metin
function shorten(s: string, max = 240): string {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
function lineCount(s: string): number {
  const t = String(s ?? "");
  return t ? t.split("\n").length : 0;
}

// response.content içinde geçen tüm file_id'leri topla
function collectFileIds(obj: unknown, acc: Set<string>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((x) => collectFileIds(x, acc));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "file_id" && typeof v === "string") acc.add(v);
    else collectFileIds(v, acc);
  }
}

type ActionDef = {
  dangerous: boolean;
  // Risk kademesi: true ise İNSAN ONAYI ister (git push, dış dünyaya giden /
  // geri alınamaz aksiyonlar). false/atlanmışsa güvenli sayılır → otomatik çalışır.
  approval?: boolean;
  project: boolean; // aktif proje yolu gerektirir mi
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  makeTitle: (p: Payload) => string;
  // Sade Türkçe "ne yapılacak" özeti (Görevler ekranında GO öncesi gösterilir)
  makeSummary: (p: Payload) => string;
  execute: (p: Payload) => Promise<string>;
};

const WORKSPACE = path.join(process.cwd(), "workspace");

function safeWorkspacePath(p: string): string {
  const cleaned = p.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.normalize(path.join(WORKSPACE, cleaned));
  if (target !== WORKSPACE && !target.startsWith(WORKSPACE + path.sep)) {
    throw new Error("Geçersiz yol.");
  }
  return target;
}

export const ACTIONS: Record<string, ActionDef> = {
  // --- Genel aksiyonlar ---
  write_file: {
    dangerous: true,
    project: false,
    description:
      "Yerel 'workspace/' klasörüne bir dosya yazar. Proje dışı genel notlar/taslaklar için. Çağrılınca hemen çalışır (GO onayı gerekmez).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "workspace içine göreli yol" },
        content: { type: "string", description: "Dosya içeriği" },
      },
      required: ["path", "content"],
    },
    makeTitle: (p) => `Dosya yaz: workspace/${String(p.path)}`,
    makeSummary: (p) =>
      `Bilgisayardaki "workspace" klasörüne "${String(p.path)}" adlı bir dosya yazılacak (${lineCount(String(p.content))} satır).\n\nİçeriğin başı:\n${shorten(String(p.content), 200)}`,
    execute: async (p) => {
      const target = safeWorkspacePath(String(p.path));
      await fs.mkdir(path.dirname(target), { recursive: true });
      const content = String(p.content ?? "");
      await fs.writeFile(target, content, "utf8");
      return `Yazıldı: workspace/${String(p.path)} (${Buffer.byteLength(content)} bayt)`;
    },
  },

  github_create_issue: {
    dangerous: true,
    approval: true, // dış dünyaya gider → insan onayı ister
    project: false,
    description:
      "Bir GitHub deposunda yeni issue açar. Yazma yetkili GITHUB_TOKEN gerekir. RİSKLİ: çağrılınca Görevler'de insan onayına düşer, onaylanınca çalışır.",
    input_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
    makeTitle: (p) =>
      `GitHub issue: ${String(p.owner)}/${String(p.repo)} — ${String(p.title)}`,
    makeSummary: (p) =>
      `GitHub'da "${String(p.owner)}/${String(p.repo)}" deposunda yeni bir konu (issue) açılacak.\nBaşlık: ${String(p.title)}${p.body ? `\nAçıklama: ${shorten(String(p.body), 200)}` : ""}`,
    execute: async (p) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return "Hata: Yazma yetkili GITHUB_TOKEN tanımlı değil.";
      const res = await fetch(
        `https://api.github.com/repos/${p.owner}/${p.repo}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "nova-assistant",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ title: p.title, body: p.body ?? "" }),
        },
      );
      if (!res.ok) return `GitHub hatası: HTTP ${res.status}`;
      const data = (await res.json()) as { html_url?: string };
      return `Issue açıldı: ${data.html_url ?? "(URL yok)"}`;
    },
  },

  generate_document: {
    dangerous: true,
    project: false,
    description:
      "Word (docx), Excel (xlsx), PowerPoint (pptx) veya PDF belgesi üretir ve workspace'e kaydeder. Kullanıcı 'bunu word/excel/sunum/pdf yap' gibi bir belge istediğinde BU ARACI DOĞRUDAN ÇAĞIR — kullanıcıya ayrıca onay sorma. Çağrılınca hemen çalışır ve belge workspace'e kaydedilir.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["docx", "xlsx", "pptx", "pdf"],
          description: "Belge türü",
        },
        filename: { type: "string", description: "Dosya adı (uzantısız olabilir)" },
        instruction: {
          type: "string",
          description: "Belgede ne olacağı — içerik, başlıklar, veriler ayrıntılı",
        },
      },
      required: ["kind", "instruction"],
    },
    makeTitle: (p) =>
      `Belge üret (${String(p.kind)}): ${String(p.filename || "nova")}`,
    makeSummary: (p) => {
      const tur: Record<string, string> = {
        docx: "Word (docx)",
        xlsx: "Excel (xlsx)",
        pptx: "PowerPoint (pptx)",
        pdf: "PDF",
      };
      const t = tur[String(p.kind)] || String(p.kind);
      return `"${String(p.filename || "nova")}" adında bir ${t} belgesi hazırlanıp "workspace" klasörüne kaydedilecek.\n\nİçerik:\n${shorten(String(p.instruction), 240)}`;
    },
    execute: async (p) => {
      const kind = ["docx", "xlsx", "pptx", "pdf"].includes(String(p.kind))
        ? String(p.kind)
        : "docx";
      const instruction = String(p.instruction ?? "");
      const base = String(p.filename || "nova").replace(/\.[a-z0-9]+$/i, "");
      const client = new Anthropic();

      // Agent Skills + code execution ile belgeyi üret
      const params = {
        model: process.env.NOVA_MODEL || "claude-opus-4-8",
        max_tokens: 16000,
        container: { skills: [{ type: "anthropic", skill_id: kind, version: "latest" }] },
        tools: [{ type: "code_execution_20250825", name: "code_execution" }],
        betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
        messages: [
          {
            role: "user",
            content: `${instruction}\n\nSonucu indirilebilir bir ${kind.toUpperCase()} dosyası olarak üret.`,
          },
        ],
      };
      // beta + container tipleri için gevşek çağrı
      const resp = (await (client.beta.messages.create as (a: unknown) => Promise<unknown>)(
        params,
      )) as { content?: unknown };

      const ids = new Set<string>();
      collectFileIds(resp.content, ids);
      if (ids.size === 0) return "Belge üretilemedi (dosya çıktısı bulunamadı).";

      await fs.mkdir(WORKSPACE, { recursive: true });
      const saved: string[] = [];
      const betas = ["files-api-2025-04-14"];
      for (const id of ids) {
        let fname = `${base}.${kind}`;
        try {
          const meta = (await (
            client.beta.files.retrieveMetadata as (a: string, b: unknown) => Promise<{ filename?: string }>
          )(id, { betas })) as { filename?: string };
          if (meta?.filename) fname = path.basename(meta.filename);
        } catch {
          /* metadata yoksa varsayılan ad */
        }
        // sadece hedef türündeki dosyaları kaydet
        if (!fname.toLowerCase().endsWith("." + kind)) continue;
        try {
          const dl = (await (
            client.beta.files.download as (a: string, b: unknown) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>
          )(id, { betas })) as { arrayBuffer: () => Promise<ArrayBuffer> };
          const buf = Buffer.from(await dl.arrayBuffer());
          const outName = saved.includes(fname) ? `${base}-${saved.length}.${kind}` : fname;
          await fs.writeFile(safeWorkspacePath(outName), buf);
          saved.push(outName);
        } catch {
          /* indirme hatası — atla */
        }
      }
      return saved.length
        ? `Belge üretildi → workspace/${saved.join(", workspace/")}`
        : "Belge üretildi ama indirilemedi.";
    },
  },

  // --- Aktif proje aksiyonları (payload'a projectPath/projectName route ekler) ---
  write_project_file: {
    dangerous: true,
    project: true,
    description:
      "Aktif projede bir dosya oluşturur/üzerine yazar. Yeni dosya eklemek için. Çağrılınca hemen çalışır (GO onayı gerekmez).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Proje köküne göre dosya yolu" },
        content: { type: "string", description: "Dosya içeriği (tamamı)" },
      },
      required: ["path", "content"],
    },
    makeTitle: (p) =>
      `[${String(p.projectName ?? "proje")}] Dosya yaz: ${String(p.path)}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesinde "${String(p.path)}" dosyası oluşturulacak / üzerine yazılacak (${lineCount(String(p.content))} satır).\n\nİçeriğin başı:\n${shorten(String(p.content), 220)}`,
    execute: async (p) => {
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const target = resolveIn(root, String(p.path));
      const content = String(p.content ?? "");
      // Boş içerikle var olan dosyayı ezme / 0 baytlık dosya yazma (içerik kesilmiş olabilir)
      if (content.trim() === "") {
        return `Hata: içerik BOŞ — dosya yazılmadı (${String(p.path)}). İçerik büyük olduğunda kesilmiş olabilir; dosyayı daha küçük parçalar halinde ya da yeniden, içeriğiyle birlikte yaz.`;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return (
        `✅ DİSKE YAZILDI: ${String(p.path)} (${Buffer.byteLength(content)} bayt). ` +
        `Dosya artık projede GERÇEKTEN mevcut — bu kesin sonuçtur. Aynı dosyayı tekrar yazma. ` +
        `Şüphen varsa list_files/read_file ile bakabilirsin; "diske yansımadı" diye DÜŞÜNME.`
      );
    },
  },

  edit_project_file: {
    dangerous: true,
    project: true,
    description:
      "Aktif projedeki bir dosyada metin değişikliği yapar (old_str → new_str). Önce read_file ile içeriği gör. Çağrılınca hemen çalışır (GO onayı gerekmez).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Proje köküne göre dosya yolu" },
        old_str: { type: "string", description: "Değiştirilecek mevcut metin" },
        new_str: { type: "string", description: "Yeni metin" },
      },
      required: ["path", "old_str", "new_str"],
    },
    makeTitle: (p) =>
      `[${String(p.projectName ?? "proje")}] Düzenle: ${String(p.path)}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesinde "${String(p.path)}" dosyasında bir bölüm değiştirilecek.\n\nESKİ HALİ:\n${shorten(String(p.old_str), 200)}\n\nYENİ HALİ:\n${shorten(String(p.new_str), 200)}`,
    execute: async (p) => {
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const target = resolveIn(root, String(p.path));
      const content = await fs.readFile(target, "utf8").catch(() => null);
      if (content === null) return `Dosya okunamadı: ${String(p.path)}`;
      const oldStr = String(p.old_str ?? "");
      if (!content.includes(oldStr)) {
        return `Hata: aranan metin dosyada bulunamadı (${String(p.path)}).`;
      }
      const next = content.split(oldStr).join(String(p.new_str ?? ""));
      await fs.writeFile(target, next, "utf8");
      return `✅ DİSKTE DÜZENLENDİ: ${String(p.path)}. Değişiklik gerçekten kaydedildi — kesin sonuçtur.`;
    },
  },

  git_commit_push: {
    dangerous: true,
    approval: true, // uzak depoya push → geri alınması zor, insan onayı ister
    project: true,
    description:
      "Aktif projede değişiklikleri commit'leyip uzak depoya (GitHub) push eder. RİSKLİ: çağrılınca Görevler'de insan onayına düşer, onaylanınca çalışır.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit mesajı" },
      },
      required: ["message"],
    },
    makeTitle: (p) =>
      `[${String(p.projectName ?? "proje")}] commit & push: ${String(p.message)}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesindeki tüm değişiklikler kaydedilip (commit) GitHub'a gönderilecek (push).\nKayıt mesajı: "${String(p.message)}"`,
    execute: async (p) => {
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const msg = String(p.message ?? "Nova güncellemesi").replace(/"/g, "'");
      const opts = {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      };
      try {
        await execAsync(`git -C "${root}" add -A`, opts);
        await execAsync(`git -C "${root}" commit -m "${msg}"`, opts);
        const { stdout } = await execAsync(`git -C "${root}" push`, opts);
        return `commit & push tamam.\n${stdout || ""}`.trim();
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        return `Git hatası: ${err.stderr || err.message || "bilinmeyen"}`;
      }
    },
  },

  run_command: {
    dangerous: true,
    project: true,
    description:
      "Aktif projede bir terminal komutu çalıştırır (test, build, script, npm/yarn, git, lint vb.). Kullanıcı bir şeyi çalıştırmanı/test etmeni/kurmanı istediğinde kullan. Çağrılınca hemen çalışır (GO onayı gerekmez); çıktıyı (stdout/stderr) döndürür.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Çalıştırılacak komut (proje kök dizininde çalışır)",
        },
      },
      required: ["command"],
    },
    makeTitle: (p) =>
      `[${String(p.projectName ?? "proje")}] çalıştır: ${String(p.command).slice(0, 90)}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesinin klasöründe şu terminal komutu çalıştırılacak (test / build / kurulum gibi bir işlem olabilir):\n\n${String(p.command)}`,
    execute: async (p) => {
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const cmd = String(p.command ?? "").trim();
      if (!cmd) return "Hata: komut boş.";
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: root,
          timeout: 300000,
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        const out =
          (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
        return out.trim().slice(0, 9000) || "(çıktı yok)";
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return `Komut hatası:\n${(err.stderr || err.message || "").slice(0, 6000)}\n${(err.stdout || "").slice(0, 3000)}`.trim();
      }
    },
  },
};

function toolDefs(filter: (d: ActionDef) => boolean) {
  return Object.entries(ACTIONS)
    .filter(([, d]) => filter(d))
    .map(([name, d]) => ({
      name,
      description: d.description,
      input_schema: d.input_schema,
    }));
}

export const GENERAL_ACTION_TOOLS = toolDefs((d) => !d.project);
export const PROJECT_ACTION_TOOLS = toolDefs((d) => d.project);

export function isActionTool(name: string): boolean {
  return name in ACTIONS;
}
export function isProjectAction(name: string): boolean {
  return !!ACTIONS[name]?.project;
}
export function actionTitle(name: string, payload: Payload): string {
  return ACTIONS[name] ? ACTIONS[name].makeTitle(payload) : name;
}
export function actionSummary(name: string, payload: Payload): string {
  try {
    return ACTIONS[name] ? ACTIONS[name].makeSummary(payload) : "";
  } catch {
    return "";
  }
}
export function actionDangerous(name: string): boolean {
  return ACTIONS[name]?.dangerous ?? true;
}
// Riskli aksiyon mu? (git push, dış dünyaya giden) → İNSAN ONAYI ister.
export function actionRequiresApproval(name: string): boolean {
  return ACTIONS[name]?.approval ?? false;
}
export async function executeAction(
  name: string,
  payload: Payload,
): Promise<string> {
  const def = ACTIONS[name];
  if (!def) throw new Error(`Bilinmeyen aksiyon: ${name}`);
  return def.execute(payload);
}
