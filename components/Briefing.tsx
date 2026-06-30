"use client";

import { useCallback, useEffect, useState } from "react";

type Briefing = {
  id: string;
  ts: number;
  loopId: string;
  loopName: string;
  content: string;
  taskId?: string;
};

export default function Briefing() {
  const [items, setItems] = useState<Briefing[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/briefings");
      const d = await r.json();
      setItems(d.briefings ?? []);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">Brifing</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Loop'ların ürettiği özetler (en yeni üstte)
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
          {items.length === 0 && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz brifing yok. &quot;Loops&quot; ekranından bir loop&apos;u
              çalıştır — çıktısı buraya düşer.
            </div>
          )}

          {items.map((b) => (
            <div
              key={b.id}
              className="rounded-xl border p-4"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <div
                className="mb-2 flex items-center gap-2 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <span style={{ color: "var(--accent)" }}>🔁 {b.loopName}</span>
                <span>· {new Date(b.ts).toLocaleString("tr-TR")}</span>
                {b.taskId && <span>· 📋 görev önerildi</span>}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {b.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
