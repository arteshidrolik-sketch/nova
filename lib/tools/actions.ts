// Aksiyonlar (yazma/komut). Model aracı çağırır; sunucu HEMEN execute() çalıştırır
// (GO onayı kaldırıldı) ve sonucu Görevler'e "tamamlandı" olarak kaydeder.
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import { resolveIn } from "./projectFiles";
import { scanContent, formatFindings } from "@/lib/security/scan";

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
      const sec = formatFindings(scanContent(String(p.path), content));
      const rel = String(p.path);
      const link = `[📄 ${rel}](/api/files?name=${encodeURIComponent(rel)})`;
      return `✅ Yazıldı: ${link} (${Buffer.byteLength(content)} bayt) — **Dosyalar** sekmesinden de indirebilirsin.${sec}`;
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

  github_create_repo: {
    dangerous: true,
    approval: true, // hesapta yeni depo yaratır → dış dünyaya gider, insan onayı ister
    project: false,
    description:
      "GitHub'da YENİ bir depo (repository) oluşturur. Yazma yetkili GITHUB_TOKEN gerekir. Kullanıcı 'yeni repo aç / GitHub'da depo oluştur' derse BU ARACI çağır. RİSKLİ: Görevler'de insan onayına düşer, onaylanınca oluşturulur. Varsayılan private. İstersen sonra git_commit_push ile kodu bu depoya gönderebilirsin.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Depo adı (ör. vyvo)" },
        description: { type: "string", description: "Kısa açıklama" },
        private: {
          type: "boolean",
          description: "Gizli mi? Varsayılan true (gizli).",
        },
        org: {
          type: "string",
          description:
            "Kişisel hesap yerine bir organizasyonda açmak için org adı (opsiyonel).",
        },
        auto_init: {
          type: "boolean",
          description:
            "README ile başlat. Varsayılan false — mevcut yerel kodu sorunsuz push edebilmek için boş depo.",
        },
      },
      required: ["name"],
    },
    makeTitle: (p) => `GitHub repo oluştur: ${String(p.name)}`,
    makeSummary: (p) =>
      `GitHub'da yeni bir depo oluşturulacak: "${String(p.name)}"${
        p.org ? ` (${String(p.org)} organizasyonunda)` : " (kişisel hesap)"
      }\nGörünürlük: ${p.private === false ? "public (herkese açık)" : "private (gizli)"}${
        p.description ? `\nAçıklama: ${shorten(String(p.description), 200)}` : ""
      }`,
    execute: async (p) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return "Hata: Yazma yetkili GITHUB_TOKEN tanımlı değil.";
      const endpoint = p.org
        ? `https://api.github.com/orgs/${p.org}/repos`
        : `https://api.github.com/user/repos`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "nova-assistant",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          name: p.name,
          description: p.description ?? "",
          private: p.private === false ? false : true, // varsayılan gizli
          auto_init: p.auto_init === true, // varsayılan boş depo
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return `GitHub hatası: HTTP ${res.status}${err.message ? ` — ${err.message}` : ""}`;
      }
      const data = (await res.json()) as {
        html_url?: string;
        clone_url?: string;
        ssh_url?: string;
      };
      return (
        `✅ Depo oluşturuldu: ${data.html_url ?? "(URL yok)"}\n` +
        `Klonlama (HTTPS): ${data.clone_url ?? "-"}\n` +
        `Kodu göndermek için: git remote add origin ${data.clone_url ?? "<url>"} && git push -u origin main`
      );
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
      if (!saved.length) return "Belge üretildi ama indirilemedi.";
      // Chat'e tıklanabilir indirme linki + "Dosyalar" sekmesi yönlendirmesi
      const links = saved
        .map((f) => `[📄 ${f}](/api/files?name=${encodeURIComponent(f)})`)
        .join("  ·  ");
      return `✅ Belge hazır: ${links}\n_(Tüm dosyalar **Dosyalar** sekmesinde — oradan da bilgisayarına indirebilirsin.)_`;
    },
  },

  edit_excel: {
    dangerous: true,
    project: false,
    description:
      "Kullanıcının YÜKLEDİĞİ bir Excel dosyasına (.xlsx) formül ekler/düzenler; orijinali (veri, biçim, hücre konumları) BOZMADAN yeni bir kopya üretir. Kullanıcı 'yüklediğim Excel'e formül ekle', 'şu hücreye şu formülü yaz', 'toplam/çarpım/KDV sütunu ekle' gibi bir şey isterse BU ARACI çağır (generate_document DEĞİL). Çağrılınca hemen çalışır, sonuç Dosyalar'a kaydedilir. `edits`: her biri {cell (ör. D2), formula (ör. =B2*C2), sheet (opsiyonel)}. Hücre adreslerini yüklenen tablonun düzeninden hesapla: 1. sütun=A, 2.=B…; başlık genelde 1. satır, veriler 2. satırdan başlar. Her veri satırı için ayrı hücre ver (D2, D3, D4…).",
    input_schema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description:
            "Uygulanacak formüller listesi. Her veri satırı için ayrı bir giriş.",
          items: {
            type: "object",
            properties: {
              cell: { type: "string", description: "Hücre adresi, ör. D2" },
              formula: {
                type: "string",
                description: "Formül (= ile veya =siz), ör. =B2*C2",
              },
              sheet: {
                type: "string",
                description: "Sayfa adı (opsiyonel; boşsa ilk sayfa)",
              },
            },
            required: ["cell", "formula"],
          },
        },
        filename: { type: "string", description: "Çıktı dosya adı (opsiyonel)" },
      },
      required: ["edits"],
    },
    makeTitle: (p) =>
      `Excel'e formül ekle (${Array.isArray(p.edits) ? (p.edits as unknown[]).length : 0} hücre)`,
    makeSummary: (p) => {
      const edits = (Array.isArray(p.edits) ? p.edits : []) as Array<{
        cell?: unknown;
        formula?: unknown;
      }>;
      const list = edits
        .slice(0, 8)
        .map((e) => `${String(e.cell)} = ${String(e.formula)}`)
        .join(", ");
      return `Yüklenen Excel'e ${edits.length} formül eklenecek (orijinal bozulmadan, yeni kopya olarak): ${list}${edits.length > 8 ? "…" : ""}`;
    },
    execute: async (p) => {
      const srcB64 = p.source_xlsx ? String(p.source_xlsx) : "";
      if (!srcB64)
        return "Hata: Önce bir Excel (.xlsx) dosyası yükle, sonra formül eklememi iste. (Yüklü dosya bulunamadı.)";
      const edits = (Array.isArray(p.edits) ? p.edits : []) as Array<{
        cell?: unknown;
        formula?: unknown;
        sheet?: unknown;
      }>;
      if (!edits.length) return "Hata: Eklenecek formül belirtilmedi.";
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await wb.xlsx.load(Buffer.from(srcB64, "base64") as any);
      } catch {
        return "Hata: Excel dosyası açılamadı (bozuk ya da desteklenmeyen biçim).";
      }
      // Açılışta formülleri yeniden hesapla (önbellek değeri boş kalmasın)
      wb.calcProperties.fullCalcOnLoad = true;
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const e of edits) {
        const cell = String(e.cell ?? "").trim();
        let formula = String(e.formula ?? "").trim();
        if (!cell || !formula) {
          skipped.push(`${cell || "?"} (eksik)`);
          continue;
        }
        if (formula.startsWith("=")) formula = formula.slice(1);
        const ws = e.sheet
          ? wb.getWorksheet(String(e.sheet))
          : wb.worksheets[0];
        if (!ws) {
          skipped.push(`${cell} (sayfa bulunamadı)`);
          continue;
        }
        try {
          ws.getCell(cell).value = { formula };
          applied.push(`${ws.name}!${cell}==${formula}`);
        } catch {
          skipped.push(`${cell} (geçersiz)`);
        }
      }
      if (!applied.length)
        return `Hiç formül uygulanamadı. Atlananlar: ${skipped.join(", ")}`;
      const baseName = String(p.filename || p.source_name || "excel").replace(
        /\.[a-z0-9]+$/i,
        "",
      );
      const outName = `${baseName}_formullu.xlsx`;
      await fs.mkdir(WORKSPACE, { recursive: true });
      const buf = await wb.xlsx.writeBuffer();
      await fs.writeFile(safeWorkspacePath(outName), Buffer.from(buf));
      const link = `[📊 ${outName}](/api/files?name=${encodeURIComponent(outName)})`;
      return (
        `✅ Formüller eklendi (orijinal korundu, yeni kopya): ${link}\n` +
        `Uygulanan (${applied.length}): ${applied.slice(0, 20).join(" · ")}${applied.length > 20 ? " …" : ""}` +
        (skipped.length ? `\n⚠️ Atlanan: ${skipped.join(", ")}` : "") +
        `\n_Dosyalar sekmesinden de indirebilirsin._`
      );
    },
  },

  generate_image: {
    dangerous: true,
    project: false,
    description:
      "Metinden görsel/resim üretir (fal.ai). Kullanıcı bir görsel, resim, avatar, logo, illüstrasyon vb. istediğinde BU ARACI DOĞRUDAN ÇAĞIR. Kullanıcı SON mesajında bir FOTOĞRAF yüklediyse o yüz otomatik referans alınır → kişiye BENZEYEN görsel üretilir. Çağrılınca hemen çalışır.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Görselin ayrıntılı tarifi: sahne, stil, ışık, atmosfer (İngilizce daha iyi sonuç verir)",
        },
        aspect: {
          type: "string",
          description: "En-boy oranı: square, portrait veya landscape (varsayılan square)",
        },
      },
      required: ["prompt"],
    },
    makeTitle: (p) => `Görsel üret: ${shorten(String(p.prompt), 48)}`,
    makeSummary: (p) =>
      `"${shorten(String(p.prompt), 140)}" için bir görsel üretilecek${p.reference_image_url ? " (yüklenen fotoğraf yüz referansı olarak kullanılacak)" : ""}.`,
    execute: async (p) => {
      const key = process.env.FAL_KEY;
      if (!key) return "Hata: FAL_KEY tanımlı değil (fal.ai anahtarı).";
      const prompt = String(p.prompt ?? "").trim();
      if (!prompt) return "Hata: görsel tarifi (prompt) boş.";
      const ref =
        typeof p.reference_image_url === "string" && p.reference_image_url
          ? p.reference_image_url
          : "";
      const sizeMap: Record<string, string> = {
        square: "square_hd",
        portrait: "portrait_4_3",
        landscape: "landscape_4_3",
      };
      const image_size = sizeMap[String(p.aspect || "square")] || "square_hd";
      // Yüz referansı varsa kimlik-koruyan model, yoksa metin→görsel
      const model = ref ? "fal-ai/flux-pulid" : "fal-ai/flux/dev";
      const body = ref
        ? { prompt, reference_image_url: ref, image_size, num_images: 1 }
        : { prompt, image_size, num_images: 1 };
      try {
        const res = await fetch(`https://fal.run/${model}`, {
          method: "POST",
          headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as {
          images?: { url?: string }[];
          detail?: unknown;
        };
        if (!res.ok) {
          const d =
            typeof data?.detail === "string"
              ? data.detail
              : JSON.stringify(data?.detail ?? data);
          return `Görsel üretilemedi (fal): ${d}`.slice(0, 400);
        }
        const url = data?.images?.[0]?.url;
        if (!url) return "Görsel üretilemedi: sonuç boş.";
        // Markdown görsel → sohbette gösterilir (route bunu akışa yansıtır)
        return `![üretilen görsel](${url})`;
      } catch (e) {
        return `Görsel üretim hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
      }
    },
  },

  generate_video: {
    dangerous: true,
    project: false,
    description:
      "Metinden ya da bir görselden VİDEO üretir (Google Veo, fal.ai). Kullanıcı bir video, klip, animasyon, 'bunu hareketlendir/videoya çevir' isterse BU ARACI çağır. Kullanıcı SON mesajında bir FOTOĞRAF yüklediyse ya da az önce bir görsel ÜRETİLDİYSE o görsel otomatik başlangıç karesi olur (image-to-video). Üretim 1-3 dakika sürer; çağrılınca hemen başlar. NOT: Video üretimi görsele göre PAHALIDIR — gereksiz/tekrarlı çağırma, kullanıcının açık isteği olmadan üretme.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Videonun ayrıntılı tarifi: sahne, hareket, kamera, atmosfer (İngilizce daha iyi sonuç verir). Görselden video ise görselde OLAN sahnenin nasıl hareket edeceğini yaz.",
        },
        aspect: {
          type: "string",
          description: "En-boy oranı: landscape (16:9) veya portrait (9:16). Varsayılan landscape.",
        },
      },
      required: ["prompt"],
    },
    makeTitle: (p) => `Video üret: ${shorten(String(p.prompt), 44)}`,
    makeSummary: (p) =>
      `"${shorten(String(p.prompt), 140)}" için bir video üretilecek${p.reference_image_url ? " (başlangıç karesi olarak bir görsel kullanılacak)" : ""}. Üretim 1-3 dakika sürebilir.`,
    execute: async (p) => {
      const key = process.env.FAL_KEY;
      if (!key) return "Hata: FAL_KEY tanımlı değil (fal.ai anahtarı).";
      const prompt = String(p.prompt ?? "").trim();
      if (!prompt) return "Hata: video tarifi (prompt) boş.";
      const ref =
        typeof p.reference_image_url === "string" && p.reference_image_url
          ? p.reference_image_url
          : "";
      const aspect_ratio = String(p.aspect || "landscape") === "portrait" ? "9:16" : "16:9";
      // Model env ile ayarlanabilir; varsayılan Veo3 "fast" (daha ucuz tier).
      // Görselden video için modelin image-to-video varyantı kullanılır.
      const base = process.env.NOVA_VIDEO_MODEL || "fal-ai/veo3/fast";
      const model = ref ? `${base}/image-to-video` : base;
      const body: Record<string, unknown> = ref
        ? { prompt, image_url: ref, aspect_ratio }
        : { prompt, aspect_ratio };
      try {
        // 1) Kuyruğa gönder (video uzun sürer → senkron istek zaman aşımına uğrar)
        const submit = await fetch(`https://queue.fal.run/${model}`, {
          method: "POST",
          headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const sub = (await submit.json().catch(() => ({}))) as {
          request_id?: string;
          status_url?: string;
          response_url?: string;
          detail?: unknown;
        };
        if (!submit.ok || !sub.status_url || !sub.response_url) {
          const d =
            typeof sub?.detail === "string"
              ? sub.detail
              : JSON.stringify(sub?.detail ?? sub);
          return `Video üretilemedi (fal): ${d}`.slice(0, 400);
        }
        // 2) Bitene kadar durum sorgula (en fazla ~4 dk)
        const deadline = Date.now() + 4 * 60 * 1000;
        let done = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5000));
          const st = await fetch(sub.status_url, {
            headers: { Authorization: `Key ${key}` },
          });
          const sd = (await st.json().catch(() => ({}))) as { status?: string };
          if (sd.status === "COMPLETED") {
            done = true;
            break;
          }
          if (sd.status === "FAILED" || sd.status === "ERROR") {
            return "Video üretilemedi: fal işi başarısız oldu.";
          }
        }
        if (!done) return "Video zaman aşımına uğradı (4 dk). Daha kısa/sade bir tarifle tekrar dene.";
        // 3) Sonucu al
        const out = await fetch(sub.response_url, {
          headers: { Authorization: `Key ${key}` },
        });
        const od = (await out.json().catch(() => ({}))) as {
          video?: { url?: string };
        };
        const url = od?.video?.url;
        if (!url) return "Video üretildi ama sonuç bağlantısı bulunamadı.";
        // Özel işaret → route akışa yansıtır, arayüz <video> olarak gösterir
        return `!video[üretilen video](${url})`;
      } catch (e) {
        return `Video üretim hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
      }
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
      const sec = formatFindings(scanContent(String(p.path), content));
      return (
        `✅ DİSKE YAZILDI: ${String(p.path)} (${Buffer.byteLength(content)} bayt). ` +
        `Dosya artık projede GERÇEKTEN mevcut — bu kesin sonuçtur. Aynı dosyayı tekrar yazma. ` +
        `Şüphen varsa list_files/read_file ile bakabilirsin; "diske yansımadı" diye DÜŞÜNME.` +
        sec
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
      const sec = formatFindings(scanContent(String(p.path), String(p.new_str ?? "")));
      return `✅ DİSKTE DÜZENLENDİ: ${String(p.path)}. Değişiklik gerçekten kaydedildi — kesin sonuçtur.${sec}`;
    },
  },

  publish_project_file: {
    dangerous: true,
    project: true,
    description:
      "Aktif projedeki bir dosyayı (ör. mockup/taslak HTML) kullanıcının indirebileceği workspace'e KOPYALAR ve gerçek indirme linki döner. Kullanıcı bir taslağı görmek/indirmek istediğinde ya da bir mockup dosyasını düzenledikten SONRA güncel halini sunmak için BU ARACI çağır — içeriği write_file ile elle yeniden YAZMA (içerik eskir/bozulur, bu araç birebir kopyalar). Çağrılınca hemen çalışır.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Proje köküne göre dosya yolu (ör. mockup/vyvo-taslak.html)",
        },
        filename: {
          type: "string",
          description: "Workspace'te görünecek ad (opsiyonel; boşsa dosya adı)",
        },
      },
      required: ["path"],
    },
    makeTitle: (p) =>
      `[${String(p.projectName ?? "proje")}] Yayınla: ${String(p.path)}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesindeki "${String(p.path)}" dosyası, kullanıcının indirebilmesi için workspace'e birebir kopyalanacak.`,
    execute: async (p) => {
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const src = resolveIn(root, String(p.path));
      const buf = await fs.readFile(src).catch(() => null);
      if (buf === null) return `Dosya okunamadı: ${String(p.path)}`;
      const name = path.basename(String(p.filename || p.path));
      await fs.mkdir(WORKSPACE, { recursive: true });
      await fs.writeFile(safeWorkspacePath(name), buf);
      const link = `[📄 ${name}](/api/files?name=${encodeURIComponent(name)})`;
      return `✅ Güncel kopya hazır: ${link} (${buf.length} bayt) — **Dosyalar** sekmesinden de indirebilirsin.`;
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

  deploy_vercel: {
    dangerous: true,
    approval: true, // dünyaya açık yayın → insan onayı ister
    project: true,
    description:
      "Aktif projeyi Vercel'e deploy edip CANLI (production) bir HTTPS URL yayınlar. Kullanıcı 'yayınla / deploy et / canlıya al / Vercel'e gönder' derse kullan. VERCEL_TOKEN gerekir. RİSKLİ: Görevler'de GO onayına düşer, onaylanınca yayınlanır. Sonunda canlı URL döner.",
    input_schema: {
      type: "object",
      properties: {
        production: {
          type: "boolean",
          description:
            "Canlı (production) yayın mı? Varsayılan true. false → geçici önizleme (preview) linki.",
        },
      },
      required: [],
    },
    makeTitle: (p) =>
      `Vercel'e yayınla: ${String(p.projectName ?? "proje")}${p.production === false ? " (önizleme)" : ""}`,
    makeSummary: (p) =>
      `"${String(p.projectName ?? "proje")}" projesi Vercel'e ${
        p.production === false ? "ÖNİZLEME (preview)" : "CANLI (production)"
      } olarak deploy edilecek. İşlem sonunda tarayıcıdan açılabilen canlı bir HTTPS adres döner.`,
    execute: async (p) => {
      const token = process.env.VERCEL_TOKEN;
      if (!token)
        return "Hata: VERCEL_TOKEN tanımlı değil. Vercel hesabından (Settings → Tokens) bir token oluşturup sunucunun .env dosyasına VERCEL_TOKEN=... ekle, sonra Nova'yı yeniden başlat.";
      const root = String(p.projectPath ?? "");
      if (!root) return "Hata: aktif proje yok.";
      const prod = p.production === false ? "" : "--prod";
      try {
        // Token komut satırında DEĞİL — Vercel CLI VERCEL_TOKEN env'ini okur.
        // `vercel` imaja global kurulu (Dockerfile) → indirme beklemesi yok.
        const { stdout, stderr } = await execAsync(
          `vercel ${prod} --yes`.trim(),
          {
            cwd: root,
            timeout: 600000, // ilk sefer CLI indirimi + build uzun sürebilir
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, VERCEL_TOKEN: token },
          },
        );
        const all = `${stdout}\n${stderr}`;
        const urls = all.match(/https?:\/\/[^\s]+\.vercel\.app/g) || [];
        const url = urls.length ? urls[urls.length - 1] : "";
        return url
          ? `✅ Yayınlandı: ${url}\n(Tarayıcıdan açabilirsin.)`
          : `Deploy komutu çalıştı ama URL yakalanamadı. Çıktı:\n${all.slice(-1500)}`;
      } catch (e) {
        const err = e as { stderr?: string; stdout?: string; message?: string };
        return `Vercel deploy hatası:\n${(err.stderr || err.message || "").slice(0, 4000)}\n${(err.stdout || "").slice(0, 2000)}`.trim();
      }
    },
  },

  vercel_set_env: {
    dangerous: true,
    approval: true, // secret yazar → insan onayı ister
    project: true,
    description:
      "Bir Vercel projesine ortam değişkeni / secret (API anahtarı, DB URL vb.) ekler veya günceller. VERCEL_TOKEN gerekir. Proje daha önce en az bir kez deploy edilmiş olmalı. RİSKLİ: Görevler'de GO onayına düşer.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Değişken adı (ör. DATABASE_URL)" },
        value: { type: "string", description: "Değeri" },
        project: {
          type: "string",
          description:
            "Vercel proje adı (verilmezse aktif proje klasör adı kullanılır).",
        },
      },
      required: ["key", "value"],
    },
    makeTitle: (p) =>
      `Vercel env: ${String(p.key)} → ${String(p.project ?? p.projectName ?? "proje")}`,
    makeSummary: (p) =>
      `"${String(p.project ?? p.projectName ?? "proje")}" Vercel projesine "${String(p.key)}" ortam değişkeni eklenecek/güncellenecek (değer gizli tutulur).`,
    execute: async (p) => {
      const token = process.env.VERCEL_TOKEN;
      if (!token) return "Hata: VERCEL_TOKEN tanımlı değil.";
      const projName =
        String(p.project ?? "") ||
        (p.projectPath ? path.basename(String(p.projectPath)) : "");
      if (!projName) return "Hata: Vercel proje adı belirlenemedi.";
      const res = await fetch(
        `https://api.vercel.com/v10/projects/${encodeURIComponent(projName)}/env?upsert=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key: String(p.key),
            value: String(p.value),
            type: "encrypted",
            target: ["production", "preview", "development"],
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        return `Vercel hatası: HTTP ${res.status}${
          err.error?.message ? ` — ${err.error.message}` : ""
        }${res.status === 404 ? " (Proje bulunamadı — önce deploy_vercel ile yayınla.)" : ""}`;
      }
      return `✅ "${String(p.key)}" ortam değişkeni ${projName} projesine yazıldı. (Etkili olması için yeniden deploy gerekebilir.)`;
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
