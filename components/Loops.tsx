"use client";

import { useCallback, useEffect, useState } from "react";

type LoopState = {
  enabled: boolean;
  lastRunTs: number | null;
  lastStatus: "idle" | "running" | "done" | "failed";
  lastSummary?: string;
};

type Loop = {
  id: string;
  name: string;
  description: string;
  scheduleLabel: string;
  state: LoopState;
};

function timeAgo(ts: number | null): string {
  if (!ts) return "hiç çalışmadı";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

export default function Loops({ onChange }: { onChange?: () => void }) {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/loops");
      const d = await r.json();
      setLoops(d.loops ?? []);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/loops/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "run" }),
      });
      await refresh();
      onChange?.(); // bekleyen görev sayısı / brifing güncellensin
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: string) {
    await fetch(`/api/loops/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "toggle" }),
    });
    refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">Loops</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Zamanlanmış iş akışları — şimdi çalıştır veya zamana bırak
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
          {loops.map((l) => {
            const running = busy === l.id || l.state.lastStatus === "running";
            return (
              <div
                key={l.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-panel)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{l.name}</div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      🕐 {l.scheduleLabel} · son çalışma:{" "}
                      {timeAgo(l.state.lastRunTs)}
                      {l.state.lastStatus === "failed" && " · ⚠️ hata"}
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(l.id)}
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      color: l.state.enabled ? "#10b981" : "var(--text-muted)",
                      background: l.state.enabled ? "#10b98119" : "transparent",
                      border: `1px solid ${l.state.enabled ? "#10b98140" : "var(--border)"}`,
                    }}
                  >
                    {l.state.enabled ? "açık" : "kapalı"}
                  </button>
                </div>

                <p
                  className="mt-2 text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  {l.description}
                </p>

                <div className="mt-3">
                  <button
                    onClick={() => run(l.id)}
                    disabled={running}
                    className="rounded-lg px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent), var(--accent-2))",
                    }}
                  >
                    {running ? "Çalışıyor…" : "▶ Şimdi çalıştır"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
