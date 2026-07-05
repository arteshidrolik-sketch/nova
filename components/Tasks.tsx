"use client";

import { useCallback, useEffect, useState } from "react";
import { AGENT_META, isAgentKey } from "@/lib/agents/meta";

type TaskStatus = "proposed" | "running" | "done" | "rejected" | "failed";

type Task = {
  id: string;
  ts: number;
  updatedAt: number;
  status: TaskStatus;
  agent: string;
  actionType: string;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
  dangerous: boolean;
  result?: string;
  error?: string;
};

const STATUS_STYLE: Record<TaskStatus, { label: string; color: string }> = {
  proposed: { label: "BEKLİYOR", color: "#f59e0b" },
  running: { label: "ÇALIŞIYOR", color: "#22d3ee" },
  done: { label: "TAMAM", color: "#10b981" },
  rejected: { label: "İPTAL", color: "#6b7280" },
  failed: { label: "HATA", color: "#ef4444" },
};

export default function Tasks({ onChange }: { onChange?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showTech, setShowTech] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks");
      const d = await r.json();
      setTasks(d.tasks ?? []);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(id: string, op: string, payload?: unknown) {
    setBusy(id);
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, payload }),
      });
      await refresh();
      onChange?.();
    } finally {
      setBusy(null);
      setEditing(null);
    }
  }

  function startEdit(t: Task) {
    setEditing(t.id);
    setDraft(JSON.stringify(t.payload, null, 2));
  }

  async function saveEdit(id: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      alert("Geçersiz JSON. Düzeltip tekrar dene.");
      return;
    }
    await act(id, "update", parsed);
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">Görevler</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Ajanların önerdiği aksiyonlar — GO ile uygula
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
          {tasks.length === 0 && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz görev yok. Sohbette bir ajana yazma işi ver (örn. &quot;workspace&apos;e
              todo.md oluştur&quot;) — öneri buraya düşer.
            </div>
          )}

          {tasks.map((t) => {
            const s = STATUS_STYLE[t.status];
            const meta = isAgentKey(t.agent) ? AGENT_META[t.agent] : null;
            const isProposed = t.status === "proposed";
            return (
              <div
                key={t.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-panel)",
                }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ color: s.color, background: `${s.color}1a` }}
                  >
                    {s.label}
                  </span>
                  {meta && (
                    <span className="text-xs" style={{ color: meta.color }}>
                      {meta.emoji} {meta.label}
                    </span>
                  )}
                  {t.dangerous && (
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      · onay gerekli
                    </span>
                  )}
                </div>

                <div className="mb-2 font-medium">{t.title}</div>

                {editing === t.id ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={8}
                    className="mb-2 w-full rounded-lg border p-2 font-mono text-xs outline-none"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                    }}
                  />
                ) : (
                  <>
                    {/* Sade "ne yapılacak" özeti — GO öncesi kullanıcı bunu okur */}
                    <div
                      className="mb-2 rounded-lg border p-3 text-sm leading-relaxed whitespace-pre-wrap"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                      }}
                    >
                      <div
                        className="mb-1 text-xs font-semibold"
                        style={{ color: "var(--accent)" }}
                      >
                        ✨ Ne yapılacak?
                      </div>
                      {t.summary?.trim()
                        ? t.summary
                        : "Bu görev için açıklama üretilmedi. Aşağıdan teknik ayrıntıya bakabilirsin."}
                    </div>

                    {/* Teknik ayrıntı (ham JSON) — varsayılan gizli */}
                    <button
                      onClick={() =>
                        setShowTech((m) => ({ ...m, [t.id]: !m[t.id] }))
                      }
                      className="mb-2 text-xs underline"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {showTech[t.id]
                        ? "▾ Teknik ayrıntıyı gizle"
                        : "▸ Teknik ayrıntı (geliştirici)"}
                    </button>
                    {showTech[t.id] && (
                      <pre
                        className="mb-2 max-h-40 overflow-auto rounded-lg p-2 text-xs"
                        style={{
                          background: "var(--bg)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {JSON.stringify(t.payload, null, 2)}
                      </pre>
                    )}
                  </>
                )}

                {t.result && (
                  <div className="mb-2 text-xs" style={{ color: "#10b981" }}>
                    ✓ {t.result}
                  </div>
                )}
                {t.error && (
                  <div className="mb-2 text-xs" style={{ color: "#ef4444" }}>
                    ✗ {t.error}
                  </div>
                )}

                {isProposed && (
                  <div className="flex gap-2">
                    {editing === t.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(t.id)}
                          disabled={busy === t.id}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                          style={{ background: "var(--accent)" }}
                        >
                          Kaydet
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="rounded-lg border px-3 py-1.5 text-sm"
                          style={{ borderColor: "var(--border)" }}
                        >
                          Vazgeç
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => act(t.id, "approve")}
                          disabled={busy === t.id}
                          className="rounded-lg px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40"
                          style={{
                            background:
                              "linear-gradient(135deg, #10b981, #22d3ee)",
                          }}
                        >
                          ▶ GO
                        </button>
                        <button
                          onClick={() => startEdit(t)}
                          disabled={busy === t.id}
                          className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                          style={{ borderColor: "var(--border)" }}
                        >
                          Düzelt
                        </button>
                        <button
                          onClick={() => act(t.id, "reject")}
                          disabled={busy === t.id}
                          className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                          style={{ borderColor: "var(--border)", color: "#ef4444" }}
                        >
                          İptal
                        </button>
                      </>
                    )}
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
