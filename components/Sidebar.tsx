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
      className="flex h-full w-full shrink-0 items-center gap-2 border-t px-3"
      style={{
        background: "rgba(14,20,34,0.82)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--border)",
      }}
    >
      {/* logo */}
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-xl">
          <span className="nova-orb absolute inset-0 rounded-xl" />
          <span className="relative text-sm font-bold text-black">N</span>
        </span>
        <span className="hidden font-semibold tracking-wide xl:block">Nova</span>
      </div>

      {/* ana menü — yatay */}
      <nav className="flex shrink-0 items-center gap-1">
        {MENU.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              title={item.label}
              className="nav-item flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm"
              style={
                isActive
                  ? {
                      background: "linear-gradient(180deg, #22d3ee22, transparent)",
                      color: "var(--text)",
                      boxShadow: "inset 0 -2px 0 var(--accent)",
                    }
                  : { color: "var(--text-muted)" }
              }
            >
              <span className="text-base">{item.icon}</span>
              <span className="hidden lg:inline">{item.label}</span>
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

      {/* ayraç */}
      <div className="mx-1 h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

      {/* yeni sohbet */}
      <button
        onClick={onNewConv}
        title="Yeni sohbet"
        className="btn-grad shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-black"
        style={{ background: "var(--grad)" }}
      >
        + Yeni
      </button>

      {/* sohbetler — yatay kaydırılır */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
                className="w-40 shrink-0 rounded-lg border px-2 py-1.5 text-sm outline-none"
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
              className="nav-item group flex shrink-0 items-center gap-0.5 rounded-lg pr-0.5"
              style={isActive ? { background: "var(--bg-elevated)" } : undefined}
            >
              <button
                onClick={() => onSelectConv(c.id)}
                className="max-w-[160px] truncate px-2.5 py-1.5 text-left text-sm"
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
    </aside>
  );
}
