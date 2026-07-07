"use client";

import { useCallback, useEffect, useState } from "react";

type CustomAgent = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  model: string;
  systemPrompt: string;
  skillIds: string[];
};
type Skill = { id: string; name: string };

const MODELS = [
  { id: "claude-fable-5", label: "Fable — hızlı/ucuz" },
  { id: "claude-sonnet-5", label: "Sonnet — dengeli" },
  { id: "claude-opus-4-8", label: "Opus — en güçlü" },
];
const COLORS = ["#22d3ee", "#a855f7", "#f472b6", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];

const empty = {
  name: "",
  description: "",
  emoji: "🤖",
  color: "#22d3ee",
  model: "claude-sonnet-5",
  systemPrompt: "",
  skillIds: [] as string[],
};

export default function Agents({
  onStartChat,
}: {
  onStartChat: (agentId: string, name: string) => void;
}) {
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        fetch("/api/agents").then((r) => r.json()),
        fetch("/api/skills").then((r) => r.json()),
      ]);
      setAgents(a.agents ?? []);
      setSkills(s.skills ?? []);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startNew() {
    setForm(empty);
    setEditing("new");
  }
  function startEdit(a: CustomAgent) {
    setForm({
      name: a.name,
      description: a.description,
      emoji: a.emoji,
      color: a.color,
      model: a.model,
      systemPrompt: a.systemPrompt,
      skillIds: a.skillIds ?? [],
    });
    setEditing(a.id);
  }
  function toggleSkill(id: string) {
    setForm((f) => ({
      ...f,
      skillIds: f.skillIds.includes(id)
        ? f.skillIds.filter((x) => x !== id)
        : [...f.skillIds, id],
    }));
  }

  async function save() {
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      alert("Ad ve sistem promptu (talimat) gerekli.");
      return;
    }
    setBusy(true);
    try {
      const url = editing === "new" ? "/api/agents" : `/api/agents/${editing}`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setEditing(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Bu ajan silinsin mi?")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    refresh();
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
          <h1 className="text-lg font-semibold">Ajanlar</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Kendi ajanını oluştur — kişilik, model ve beceriler. Haritada da kol olarak belirir.
          </p>
        </div>
        <button
          onClick={startNew}
          className="btn-grad rounded-lg px-4 py-1.5 text-sm font-medium text-black"
          style={{ background: "var(--grad)" }}
        >
          + Yeni ajan
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {editing && (
            <div
              className="space-y-3 rounded-xl border p-4"
              style={{ borderColor: "var(--accent)", background: "var(--bg-panel)" }}
            >
              <div className="text-sm font-medium">
                {editing === "new" ? "Yeni ajan" : "Ajanı düzenle"}
              </div>
              <div className="flex gap-2">
                <input
                  value={form.emoji}
                  onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                  placeholder="🤖"
                  className="w-14 rounded-lg border px-3 py-2 text-center text-lg outline-none"
                  style={inputStyle}
                />
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ajan adı (örn. Akademik Yazar)"
                  className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Kısa açıklama (1 cümle)"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={7}
                placeholder="Sistem promptu — bu ajan nasıl davransın? Rolü, üslubu, kuralları, uzmanlığı…"
                className="w-full rounded-lg border p-2 text-sm outline-none"
                style={inputStyle}
              />

              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>Model</div>
                  <select
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="rounded-lg border px-2 py-1.5 text-sm outline-none"
                    style={inputStyle}
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>Renk</div>
                  <div className="flex gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setForm({ ...form, color: c })}
                        className="h-6 w-6 rounded-full"
                        style={{
                          background: c,
                          outline: form.color === c ? "2px solid var(--text)" : "none",
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {skills.length > 0 && (
                <div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    Yüklenecek beceriler (opsiyonel)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {skills.map((s) => {
                      const on = form.skillIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => toggleSkill(s.id)}
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            color: on ? "#04121a" : "var(--accent)",
                            background: on ? "var(--accent)" : "var(--accent-bg, #22d3ee1a)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          🧩 {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={busy}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: "var(--accent)" }}
                >
                  {busy ? "Kaydediliyor…" : "Kaydet"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}

          {agents.length === 0 && !editing && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz özel ajan yok. &quot;+ Yeni ajan&quot; ile oluştur.
            </div>
          )}

          {agents.map((a) => (
            <div
              key={a.id}
              className="card rounded-xl border p-4"
              style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-base"
                  style={{ background: `${a.color}22`, border: `1px solid ${a.color}66` }}
                >
                  {a.emoji}
                </span>
                <span className="font-medium" style={{ color: a.color }}>{a.name}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  · {MODELS.find((m) => m.id === a.model)?.label.split(" ")[0] ?? a.model}
                </span>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <button
                    onClick={() => onStartChat(a.id, a.name)}
                    className="rounded-lg px-3 py-1 font-medium text-black"
                    style={{ background: a.color }}
                  >
                    💬 Sohbet başlat
                  </button>
                  <button onClick={() => startEdit(a)} style={{ color: "var(--text-muted)" }}>
                    düzenle
                  </button>
                  <button onClick={() => remove(a.id)} style={{ color: "#ef4444" }}>
                    sil
                  </button>
                </div>
              </div>
              {a.description && (
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  {a.description}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
