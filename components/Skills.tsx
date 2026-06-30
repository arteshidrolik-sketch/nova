"use client";

import { useCallback, useEffect, useState } from "react";
import { AGENT_KEYS, AGENT_META, type AgentKey } from "@/lib/agents/meta";

type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  agentKeys: AgentKey[];
  source?: string;
};

const empty = {
  name: "",
  description: "",
  content: "",
  agentKeys: [] as AgentKey[],
  source: "",
};

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // id veya "new"
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/skills");
      const d = await r.json();
      setSkills(d.skills ?? []);
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
  function startEdit(s: Skill) {
    setForm({
      name: s.name,
      description: s.description,
      content: s.content,
      agentKeys: s.agentKeys,
      source: s.source ?? "",
    });
    setEditing(s.id);
  }
  function toggleAgent(k: AgentKey) {
    setForm((f) => ({
      ...f,
      agentKeys: f.agentKeys.includes(k)
        ? f.agentKeys.filter((x) => x !== k)
        : [...f.agentKeys, k],
    }));
  }

  async function save() {
    if (!form.name.trim() || !form.content.trim() || form.agentKeys.length === 0) {
      alert("Ad, içerik ve en az bir ajan gerekli.");
      return;
    }
    setBusy(true);
    try {
      const url = editing === "new" ? "/api/skills" : `/api/skills/${editing}`;
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
    if (!confirm("Bu beceri silinsin mi?")) return;
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
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
          <h1 className="text-lg font-semibold">Beceriler</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Ajanlara işine özel bilgi/talimat yükle — atanan ajan her cevapta kullanır
          </p>
        </div>
        <button
          onClick={startNew}
          className="btn-grad rounded-lg px-4 py-1.5 text-sm font-medium text-black"
          style={{ background: "var(--grad)" }}
        >
          + Yeni beceri
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {editing && (
            <div
              className="space-y-2 rounded-xl border p-4"
              style={{ borderColor: "var(--accent)", background: "var(--bg-panel)" }}
            >
              <div className="text-sm font-medium">
                {editing === "new" ? "Yeni beceri" : "Beceriyi düzenle"}
              </div>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Beceri adı (örn. TDD disiplini)"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Kısa açıklama (1 cümle)"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={8}
                placeholder="Talimat/bilgi (ajanın sistem promptuna eklenir) — kurallar, kontrol listeleri, yöntem…"
                className="w-full rounded-lg border p-2 text-sm outline-none"
                style={inputStyle}
              />
              <input
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                placeholder="(Opsiyonel) kaynak URL"
                className="w-full rounded-lg border px-3 py-2 text-xs outline-none"
                style={inputStyle}
              />
              <div>
                <div className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  Hangi ajanlara yüklensin?
                </div>
                <div className="flex flex-wrap gap-2">
                  {AGENT_KEYS.map((k) => {
                    const on = form.agentKeys.includes(k);
                    const m = AGENT_META[k];
                    return (
                      <button
                        key={k}
                        onClick={() => toggleAgent(k)}
                        className="rounded-full px-3 py-1 text-xs font-medium"
                        style={{
                          color: on ? "#04121a" : m.color,
                          background: on ? m.color : `${m.color}1a`,
                          border: `1px solid ${m.color}55`,
                        }}
                      >
                        {m.emoji} {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
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

          {skills.length === 0 && !editing && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz beceri yok. &quot;+ Yeni beceri&quot; ile ekle.
            </div>
          )}

          {skills.map((s) => (
            <div
              key={s.id}
              className="card rounded-xl border p-4"
              style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">🧩 {s.name}</span>
                <div className="ml-auto flex gap-2 text-xs">
                  <button
                    onClick={() => startEdit(s)}
                    style={{ color: "var(--text-muted)" }}
                  >
                    düzenle
                  </button>
                  <button onClick={() => remove(s.id)} style={{ color: "#ef4444" }}>
                    sil
                  </button>
                </div>
              </div>
              {s.description && (
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  {s.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.agentKeys.map((k) => {
                  const m = AGENT_META[k];
                  return (
                    <span
                      key={k}
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ color: m.color, background: `${m.color}1a` }}
                    >
                      {m.emoji} {m.label}
                    </span>
                  );
                })}
              </div>
              {s.source && (
                <a
                  href={s.source}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-xs underline"
                  style={{ color: "var(--accent)" }}
                >
                  {s.source}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
