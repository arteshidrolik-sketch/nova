"use client";

import { useCallback, useEffect, useState } from "react";
import { AGENT_META, isAgentKey } from "@/lib/agents/meta";

type AuditEntry = {
  id: string;
  ts: number;
  agent: string;
  model?: string;
  action: string;
  tier: "auto" | "approval" | "control";
  summary: string;
  ok: boolean;
  result?: string;
  project?: string;
};

const TIER_STYLE: Record<string, { label: string; color: string }> = {
  auto: { label: "OTOMATİK", color: "#10b981" },
  approval: { label: "ONAYLI", color: "#f59e0b" },
  control: { label: "KONTROL", color: "#a855f7" },
};

function timeStr(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (tier) p.set("tier", tier);
      if (q.trim()) p.set("q", q.trim());
      p.set("limit", "300");
      const r = await fetch(`/api/audit?${p.toString()}`);
      const d = await r.json();
      setEntries(d.entries ?? []);
    } catch {
      /* yoksay */
    }
  }, [tier, q]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">📜 Denetim Defteri</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nova ne yaptı? — append-only eylem kaydı (silinemez)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
          >
            <option value="">Tüm kademeler</option>
            <option value="auto">Otomatik</option>
            <option value="approval">Onaylı</option>
            <option value="control">Kontrol</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ara: eylem / özet / proje"
            className="w-52 rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          <button
            onClick={refresh}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            ↻
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-4xl space-y-1.5">
          {entries.length === 0 && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-panel)", color: "var(--text-muted)" }}
            >
              Henüz kayıt yok. Bir aksiyon çalıştıkça (dosya yazma, komut, push, kill switch…) buraya düşer.
            </div>
          )}
          {entries.map((e) => {
            const s = TIER_STYLE[e.tier] || TIER_STYLE.auto;
            const meta = isAgentKey(e.agent) ? AGENT_META[e.agent] : null;
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
              >
                <span
                  className="mt-0.5 shrink-0 font-mono text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {timeStr(e.ts)}
                </span>
                <span
                  className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ color: s.color, background: `${s.color}1a` }}
                >
                  {s.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs" style={{ color: e.ok ? "var(--text)" : "#ef4444" }}>
                      {e.ok ? "" : "✗ "}
                      {e.action}
                    </span>
                    {meta && (
                      <span className="text-[11px]" style={{ color: meta.color }}>
                        {meta.emoji} {meta.label}
                      </span>
                    )}
                    {e.project && (
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        · {e.project}
                      </span>
                    )}
                  </div>
                  <div className="truncate" style={{ color: "var(--text-muted)" }} title={e.summary}>
                    {e.summary}
                  </div>
                  {e.result && (
                    <div className="truncate text-xs" style={{ color: "#10b981" }} title={e.result}>
                      → {e.result}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
