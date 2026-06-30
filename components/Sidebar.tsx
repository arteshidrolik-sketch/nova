"use client";

import { useState } from "react";

export type ViewKey =
  | "harita"
  | "brifing"
  | "tasks"
  | "projeler"
  | "beceriler"
  | "surumler"
  | "loops"
  | "ayarlar";

export type ConvMeta = { id: string; title: string; updatedAt: number };

const MENU: { key: ViewKey; label: string; icon: string }[] = [
  { key: "harita", label: "Çalışma Alanı", icon: "🕸️" },
  { key: "brifing", label: "Brifing", icon: "📋" },
  { key: "tasks", label: "Görevler", icon: "✅" },
  { key: "projeler", label: "Projeler", icon: "📁" },
  { key: "beceriler", label: "Beceriler", icon: "🧩" },
  { key: "surumler", label: "Sürümler", icon: "🚀" },
  { key: "loops", label: "Loops", icon: "🔁" },
  { key: "ayarlar", label: "Ayarlar", icon: "⚙️" },
];

export default function Sidebar({
  active,
  onSelect,
  pendingCount,
  conversations,
  activeConv,
  onNewConv,
  onSelectConv,
  onRenameConv,
  onDeleteConv,
}: {
  active: ViewKey;
  onSelect: (key: ViewKey) => void;
  pendingCount: number;
  conversations: ConvMeta[];
  activeConv: string | null;
  onNewConv: () => void;
  onSelectConv: (id: string) => void;
  onRenameConv: (id: string, title: string) => void;
  onDeleteConv: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(c: ConvMeta) {
    setEditingId(c.id);
    setDraft(c.title);
  }
  function commitEdit() {
    if (editingId && draft.trim()) onRenameConv(editingId, draft.trim());
    setEditingId(null);
  }

  return (
    <aside
      className="flex h-full w-52 shrink-0 flex-col border-r"
      style={{
        background: "rgba(14,20,34,0.72)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--border)",
      }}
    >
      {/* logo */}
      <div
        className="flex items-center gap-3 border-b px-5 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-xl">
          <span className="nova-orb absolute inset-0 rounded-xl" />
          <span className="relative text-sm font-bold text-black">N</span>
        </span>
        <div className="leading-tight">
          <div className="font-semibold tracking-wide">Nova</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Geliştirici Asistanı
          </div>
        </div>
      </div>

      {/* ana menü */}
      <nav className="space-y-1 p-3">
        {MENU.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className="nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
              style={
                isActive
                  ? {
                      background:
                        "linear-gradient(90deg, #22d3ee1f, transparent)",
                      color: "var(--text)",
                      boxShadow: "inset 3px 0 0 var(--accent)",
                    }
                  : { color: "var(--text-muted)" }
              }
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.key === "tasks" && pendingCount > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-xs font-semibold text-black"
                  style={{ background: "var(--accent)" }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* sohbetler */}
      <div
        className="flex items-center justify-between border-t px-4 pb-2 pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Sohbetler
        </span>
        <button
          onClick={onNewConv}
          title="Yeni sohbet"
          className="btn-grad rounded-lg px-2 py-1 text-xs font-medium text-black"
          style={{ background: "var(--grad)" }}
        >
          + Yeni
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {conversations.length === 0 && (
          <div
            className="px-2 py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Henüz sohbet yok.
          </div>
        )}
        {conversations.map((c) => {
          const isActive = c.id === activeConv;
          if (editingId === c.id) {
            return (
              <input
                key={c.id}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none"
                style={{
                  borderColor: "var(--accent)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
            );
          }
          return (
            <div
              key={c.id}
              className="nav-item group flex items-center gap-1 rounded-lg pr-1"
              style={
                isActive
                  ? { background: "var(--bg-elevated)" }
                  : undefined
              }
            >
              <button
                onClick={() => onSelectConv(c.id)}
                className="flex-1 truncate px-3 py-2 text-left text-sm"
                style={{ color: isActive ? "var(--text)" : "var(--text-muted)" }}
                title={c.title}
              >
                💬 {c.title}
              </button>
              <button
                onClick={() => startEdit(c)}
                title="Yeniden adlandır"
                className="px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--text-muted)" }}
              >
                ✎
              </button>
              <button
                onClick={() => {
                  if (confirm(`"${c.title}" silinsin mi?`)) onDeleteConv(c.id);
                }}
                title="Sil"
                className="px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "#ef4444" }}
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>

      <div
        className="border-t px-4 py-3 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        Nova · lokal
      </div>
    </aside>
  );
}
