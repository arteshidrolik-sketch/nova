"use client";

import { useCallback, useEffect, useState } from "react";

type FileItem = { name: string; rel: string; size: number; mtime: number };

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
function iconFor(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (e === "docx" || e === "doc") return "📝";
  if (e === "xlsx" || e === "xls" || e === "csv") return "📊";
  if (e === "pptx" || e === "ppt") return "📽️";
  if (e === "pdf") return "📕";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "🖼️";
  if (["md", "txt", "json", "html"].includes(e)) return "📄";
  return "📎";
}

export default function Files() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/files").then((r) => r.json());
      setFiles(Array.isArray(d.files) ? d.files : []);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function del(rel: string) {
    if (!confirm(`"${rel}" silinsin mi?`)) return;
    await fetch(`/api/files?name=${encodeURIComponent(rel)}`, {
      method: "DELETE",
    });
    load();
  }

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            📥 Dosyalar
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nova&apos;nın ürettiği belgeler burada birikir — bilgisayarına indir.
          </p>
        </div>
        <button
          onClick={load}
          className="shrink-0 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          ↻ Yenile
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Yükleniyor…
        </p>
      ) : files.length === 0 ? (
        <div
          className="rounded-xl border border-dashed py-14 text-center"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <div className="text-3xl">🗂️</div>
          <p className="mt-2 text-sm">Henüz dosya yok.</p>
          <p className="mt-1 text-xs">
            Nova&apos;dan bir belge (Word/Excel/PDF/sunum) iste; burada belirir.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li
              key={f.rel}
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              style={{
                borderColor: "var(--border)",
                background: "rgba(14,20,34,0.5)",
              }}
            >
              <span className="text-2xl">{iconFor(f.name)}</span>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--text)" }}
                  title={f.rel}
                >
                  {f.rel}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {fmtSize(f.size)} · {fmtDate(f.mtime)}
                </div>
              </div>
              <a
                href={`/api/files?name=${encodeURIComponent(f.rel)}`}
                download
                className="btn-grad shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-black"
                style={{ background: "var(--grad)" }}
              >
                ⬇ İndir
              </a>
              <button
                onClick={() => del(f.rel)}
                title="Sil"
                className="shrink-0 rounded-lg px-2 py-1.5 text-sm"
                style={{ color: "#ef4444" }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
