"use client";

import { useCallback, useEffect, useState } from "react";

type Control = {
  stopped: boolean;
  stoppedAt: number | null;
  reason: string | null;
};

// Aksiyon risk kademeleri (bilgi amaçlı — actions.ts ile uyumlu)
const TIERS: { label: string; color: string; items: string[] }[] = [
  {
    label: "Güvenli — otomatik çalışır",
    color: "#10b981",
    items: [
      "Dosya yazma / düzenleme (write/edit_project_file)",
      "Komut çalıştırma (run_command)",
      "Belge üretme (generate_document)",
      "Okuma araçları (list/read/search)",
    ],
  },
  {
    label: "Riskli — GO onayı bekler",
    color: "#f59e0b",
    items: [
      "Uzak depoya push (git_commit_push)",
      "GitHub issue açma (github_create_issue)",
    ],
  },
];

type BudgetStatus = {
  cap: number;
  used: number;
  input: number;
  output: number;
  costUsd: number;
  requests: number;
  pct: number;
  warn: boolean;
  over: boolean;
};

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

export default function Guardrail() {
  const [control, setControl] = useState<Control | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [capInput, setCapInput] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([
        fetch("/api/control").then((r) => r.json()),
        fetch("/api/budget").then((r) => r.json()),
      ]);
      setControl(c.control ?? null);
      setBudget(b.status ?? null);
    } catch {
      /* yoksay */
    }
  }, []);

  async function saveCap() {
    const cap = Number(capInput.replace(/[^\d]/g, "")) || 0;
    setBusy(true);
    try {
      await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "setCap", cap }),
      });
      setCapInput("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  async function toggle(stop: boolean) {
    if (stop && !confirm("Tüm ajan işlerini DURDUR? Çalışan sohbet işi kesilir.")) return;
    setBusy(true);
    try {
      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          stop ? { op: "stop", reason: "Panelden durduruldu" } : { op: "resume" },
        ),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const stopped = control?.stopped ?? false;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">🛡️ Kontrol (Guardrail)</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Kill switch ve risk kademeleri — ajan güvenlik katmanı
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Kill switch */}
          <section
            className="rounded-xl border p-5"
            style={{
              borderColor: stopped ? "#ef4444" : "var(--border)",
              background: stopped ? "#ef444414" : "var(--bg-panel)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: stopped ? "#ef4444" : "#10b981",
                  boxShadow: `0 0 10px ${stopped ? "#ef4444" : "#10b981"}`,
                }}
              />
              <span className="font-semibold">
                {stopped ? "DURDURULDU" : "Ajanlar çalışıyor"}
              </span>
              {stopped && control?.reason && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  · {control.reason}
                </span>
              )}
            </div>
            <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Acil durdurma: yeni sohbet işleri başlamaz, çalışan iş bir sonraki
              adımda kesilir. Devam edene kadar tüm ajan aksiyonları kilitlidir.
            </p>
            {stopped ? (
              <button
                onClick={() => toggle(false)}
                disabled={busy}
                className="rounded-lg px-5 py-2.5 text-sm font-bold text-black disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #10b981, #22d3ee)" }}
              >
                ▶ DEVAM ET
              </button>
            ) : (
              <button
                onClick={() => toggle(true)}
                disabled={busy}
                className="rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                style={{ background: "#ef4444" }}
              >
                ⛔ TÜM AJANLARI DURDUR
              </button>
            )}
          </section>

          {/* Bütçe kapıları */}
          <section
            className="rounded-xl border p-5"
            style={{
              borderColor: budget?.over
                ? "#ef4444"
                : budget?.warn
                  ? "#f59e0b"
                  : "var(--border)",
              background: "var(--bg-panel)",
            }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">💸 Günlük token bütçesi</span>
              {budget && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  bugün {budget.requests} istek · ~${budget.costUsd.toFixed(2)}
                </span>
              )}
            </div>

            {budget && (
              <>
                <div className="mb-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  {fmt(budget.used)} token kullanıldı
                  {budget.cap > 0 ? ` / ${fmt(budget.cap)} tavan` : " · tavan: sınırsız"}
                  {budget.cap > 0 && ` (%${budget.pct})`}
                </div>
                {budget.cap > 0 && (
                  <div
                    className="mb-3 h-2 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--bg)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${budget.pct}%`,
                        background: budget.over
                          ? "#ef4444"
                          : budget.warn
                            ? "#f59e0b"
                            : "#10b981",
                      }}
                    />
                  </div>
                )}
                {budget.over && (
                  <div className="mb-2 text-sm font-medium" style={{ color: "#ef4444" }}>
                    ⛔ Tavan doldu — yeni işler durduruldu.
                  </div>
                )}
                {budget.warn && (
                  <div className="mb-2 text-sm font-medium" style={{ color: "#f59e0b" }}>
                    ⚠️ Tavanın %80'i aşıldı.
                  </div>
                )}
              </>
            )}

            <div className="mt-2 flex items-center gap-2">
              <input
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                placeholder={
                  budget?.cap ? `Mevcut: ${budget.cap}` : "günlük token tavanı (0 = sınırsız)"
                }
                inputMode="numeric"
                className="w-56 rounded-lg border px-3 py-1.5 text-sm outline-none"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
              <button
                onClick={saveCap}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                style={{ background: "var(--accent)" }}
              >
                Kaydet
              </button>
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Tavan dolunca çalışan iş güvenle biter, yeni iş alınmaz. Maliyet ~tahminidir.
            </p>
          </section>

          {/* Risk kademeleri */}
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
          >
            <div className="mb-3 font-semibold">Aksiyon risk kademeleri</div>
            <div className="space-y-4">
              {TIERS.map((tier) => (
                <div key={tier.label}>
                  <div
                    className="mb-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ color: tier.color, background: `${tier.color}1a` }}
                  >
                    {tier.label}
                  </div>
                  <ul className="ml-1 space-y-1">
                    {tier.items.map((it) => (
                      <li
                        key={it}
                        className="text-sm"
                        style={{ color: "var(--text-muted)" }}
                      >
                        · {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              Riskli aksiyonlar sohbette çağrılınca &quot;Görevler&quot;de GO onayı
              bekler. Prod deploy, para, secret gibi işler ajanlara kapalıdır.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
