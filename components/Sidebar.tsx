"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
import RadarGame from "./RadarGame";

// Tarayıcı tam ekran yardımcıları (Safari/eski tarayıcı prefiksleri dahil)
type FsDoc = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void>;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
function fsElement(): Element | null {
  const d = document as FsDoc;
  return d.fullscreenElement || d.webkitFullscreenElement || null;
}

export type ViewKey =
  | "harita"
  | "brifing"
  | "tasks"
  | "projeler"
  | "beceriler"
  | "surumler"
  | "loops"
  | "ajanlar"
  | "guardrail"
  | "denetim"
  | "dosyalar"
  | "fatura"
  | "ayarlar";

export type ConvMeta = {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
};

const MENU: { key: ViewKey; label: string; icon: string }[] = [
  { key: "harita", label: "Çalışma Alanı", icon: "🕸️" },
  { key: "brifing", label: "Brifing", icon: "📋" },
  { key: "tasks", label: "Görevler", icon: "✅" },
  { key: "projeler", label: "Projeler", icon: "📁" },
  { key: "dosyalar", label: "Dosyalar", icon: "📥" },
  { key: "fatura", label: "Fatura", icon: "🧾" },
  { key: "beceriler", label: "Beceriler", icon: "🧩" },
  { key: "surumler", label: "Sürümler", icon: "🚀" },
  { key: "loops", label: "Loops", icon: "🔁" },
  { key: "ajanlar", label: "Ajanlar", icon: "🤖" },
  { key: "guardrail", label: "Kontrol", icon: "🛡️" },
  { key: "denetim", label: "Denetim", icon: "📜" },
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
  onOpenRadar,
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
  onOpenRadar?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Tarayıcı tam ekran durumu
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const on = () => setIsFs(!!fsElement());
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);
  function toggleFs() {
    const d = document as FsDoc;
    const el = document.documentElement as FsEl;
    if (fsElement()) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  }

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
      className="flex h-full w-full shrink-0 flex-col border-t"
      style={{
        background: "rgba(14,20,34,0.82)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--border)",
      }}
    >
      {/* 1. satır: logo + ana menü — ekrana yayılmış */}
      <div className="flex flex-1 items-center gap-2 px-3">
        {/* logo */}
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl">
            <span className="nova-orb absolute inset-0 rounded-xl" />
            <span className="relative text-sm font-bold text-black">N</span>
          </span>
          <span className="hidden font-semibold tracking-wide xl:block">
            {process.env.NEXT_PUBLIC_APP_NAME || "Nova"}
          </span>
        </div>

        {/* ana menü — kalan genişliğe eşit yayılır */}
        <nav className="flex flex-1 items-stretch gap-1">
          {MENU.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                onClick={() => onSelect(item.key)}
                title={item.label}
                className="nav-item flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm"
                style={
                  isActive
                    ? {
                        background: "linear-gradient(180deg, #4fd8ff22, transparent)",
                        color: "var(--text)",
                        boxShadow: "inset 0 -2px 0 var(--accent)",
                      }
                    : { color: "var(--text-muted)" }
                }
              >
                <Icon name={item.key} size={18} />
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

        {/* Ayarların sağında: tam ekran + küçük animasyonlu radar simgesi */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={toggleFs}
            title={isFs ? "Tam ekrandan çık" : "Tam ekran"}
            aria-label={isFs ? "Tam ekrandan çık" : "Tam ekran"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {isFs ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v6H3M21 15h-6v6M9 9 3 3M21 21l-6-6" /></svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            )}
          </button>
          {onOpenRadar && (
            <button
              onClick={onOpenRadar}
              title="Radarı tam ekran aç"
              aria-label="Radarı tam ekran aç"
              className="relative h-9 w-9 overflow-hidden rounded-lg border"
              style={{ borderColor: "#1c5140", background: "#060d0b" }}
            >
              <RadarGame active={null} voice="idle" mini />
            </button>
          )}
        </div>
      </div>

      {/* satır ayracı */}
      <div className="h-px w-full shrink-0" style={{ background: "var(--border)" }} />

      {/* 2. satır: yeni sohbet + sohbetler — yatay kaydırılır */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* yeni sohbet */}
        <button
          onClick={onNewConv}
          title="Yeni sohbet"
          className="btn-grad shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-black"
          style={{ background: "var(--grad)" }}
        >
          + Yeni
        </button>

        {/* sohbetler */}
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
                {c.pinned ? "📌" : "💬"} {c.title}
              </button>
              <button
                onClick={() => startEdit(c)}
                title="Yeniden adlandır"
                className="px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--text-muted)" }}
              >
                ✎
              </button>
              {!c.pinned && (
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
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
