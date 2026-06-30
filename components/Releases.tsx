"use client";

import { useCallback, useEffect, useState } from "react";

type ReleaseStatus = "draft" | "submitted" | "in_review" | "live" | "rejected";

type Release = {
  id: string;
  project: string;
  version: string;
  platform: "ios" | "android" | "web";
  status: ReleaseStatus;
  storeUrl?: string;
  rejectionReason?: string;
  fixPlan?: string;
  content?: {
    changelogUser?: string;
    changelogTech?: string;
    whatsNewTr?: string;
    whatsNewEn?: string;
    aso?: { title?: string; keywords?: string; description?: string };
  };
};

const STATUS_STYLE: Record<ReleaseStatus, { label: string; color: string }> = {
  draft: { label: "TASLAK", color: "#6b7280" },
  submitted: { label: "GÖNDERİLDİ", color: "#3b82f6" },
  in_review: { label: "İNCELEMEDE", color: "#f59e0b" },
  live: { label: "YAYINDA", color: "#10b981" },
  rejected: { label: "REDDEDİLDİ", color: "#ef4444" },
};

const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web" };

function Section({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
        {title}
      </div>
      <pre
        className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-xs leading-relaxed"
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        {text}
      </pre>
    </div>
  );
}

export default function Releases({ onChange }: { onChange?: () => void }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [project, setProject] = useState("");
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState<Release["platform"]>("ios");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/releases");
      const d = await r.json();
      setReleases(d.releases ?? []);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addRelease() {
    if (!project.trim() || !version.trim()) return;
    setBusy("new");
    try {
      await fetch("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, version, platform }),
      });
      setProject("");
      setVersion("");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function op(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await fetch(`/api/releases/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  const inputStyle = {
    borderColor: "var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
  };

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">Sürümler</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Release & Store — içerik üret, durum izle, reddi analiz et
          </p>
        </div>
        <button
          onClick={refresh}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          ↻ Yenile
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* yeni sürüm */}
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
            style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
          >
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Proje (örn. GetDriver)"
              className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Versiyon (örn. 1.2.0)"
              className="w-36 rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
            />
            <select
              value={platform}
              onChange={(e) =>
                setPlatform(e.target.value as Release["platform"])
              }
              className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={inputStyle}
            >
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="web">Web</option>
            </select>
            <button
              onClick={addRelease}
              disabled={busy === "new" || !project.trim() || !version.trim()}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              + Ekle
            </button>
          </div>

          {releases.length === 0 && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz sürüm yok. Yukarıdan bir sürüm ekle, sonra &quot;İçerik
              üret&quot; ile changelog + what&apos;s new (TR/EN) + ASO üret.
            </div>
          )}

          {releases.map((r) => {
            const s = STATUS_STYLE[r.status];
            const isBusy = busy === r.id;
            return (
              <div
                key={r.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-panel)",
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {r.project} {r.version}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {PLATFORM_LABEL[r.platform]}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ color: s.color, background: `${s.color}1a` }}
                  >
                    {s.label}
                  </span>
                  {r.storeUrl && (
                    <a
                      href={r.storeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline"
                      style={{ color: "var(--accent)" }}
                    >
                      store linki ↗
                    </a>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      value={r.status}
                      onChange={(e) => op(r.id, { op: "status", status: e.target.value })}
                      disabled={isBusy}
                      className="rounded-lg border px-2 py-1 text-xs outline-none"
                      style={inputStyle}
                    >
                      {(Object.keys(STATUS_STYLE) as ReleaseStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {STATUS_STYLE[st].label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => op(r.id, { op: "delete" })}
                      disabled={isBusy}
                      className="text-xs"
                      style={{ color: "#ef4444" }}
                    >
                      sil
                    </button>
                  </div>
                </div>

                {/* içerik üret */}
                <div className="mt-3">
                  <textarea
                    value={notes[r.id] ?? ""}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="(Opsiyonel) bu sürümdeki değişiklik notların…"
                    className="w-full rounded-lg border p-2 text-sm outline-none"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => op(r.id, { op: "generate", notes: notes[r.id] ?? "" })}
                    disabled={isBusy}
                    className="mt-2 rounded-lg px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent), var(--accent-2))",
                    }}
                  >
                    {isBusy ? "Üretiliyor…" : "✨ İçerik üret"}
                  </button>
                </div>

                {/* üretilen içerik */}
                {r.content && (
                  <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <Section title="Changelog (kullanıcı)" text={r.content.changelogUser} />
                    <Section title="Changelog (teknik)" text={r.content.changelogTech} />
                    <Section title="What's New (TR)" text={r.content.whatsNewTr} />
                    <Section title="What's New (EN)" text={r.content.whatsNewEn} />
                    {r.content.aso && (
                      <Section
                        title="ASO"
                        text={[
                          r.content.aso.title && `Başlık: ${r.content.aso.title}`,
                          r.content.aso.keywords &&
                            `Anahtar kelimeler: ${r.content.aso.keywords}`,
                          r.content.aso.description &&
                            `Açıklama: ${r.content.aso.description}`,
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      />
                    )}
                  </div>
                )}

                {/* red analizi */}
                {r.status === "rejected" && (
                  <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <textarea
                      value={reasons[r.id] ?? r.rejectionReason ?? ""}
                      onChange={(e) =>
                        setReasons((x) => ({ ...x, [r.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="Red nedeni (mağazadan gelen mesaj)…"
                      className="w-full rounded-lg border p-2 text-sm outline-none"
                      style={inputStyle}
                    />
                    <button
                      onClick={() =>
                        op(r.id, {
                          op: "analyzeRejection",
                          rejectionReason: reasons[r.id] ?? r.rejectionReason ?? "",
                        })
                      }
                      disabled={isBusy}
                      className="mt-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                      style={{ borderColor: "var(--border)", color: "#ef4444" }}
                    >
                      {isBusy ? "Analiz ediliyor…" : "🔧 Reddi analiz et → düzeltme görevi öner"}
                    </button>
                    <Section title="Düzeltme planı" text={r.fixPlan} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
