"use client";

// Proje sayfası: bir gezegene tıklayınca açılır. Sol ikon rayı (mobilde üstte)
// ile sekmeler: Sohbet (bu projenin yapay zekâ sohbeti), Dosyalar (yalnız bu
// projenin klasörü), Hafıza (yalnız bu projenin notları), Beceriler, Ajanlar,
// Görevler. Sohbet, projenin kendi conversationId'si ile çalışır → yalıtılmış.
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import Chat from "./Chat";
import Files from "./Files";
import Skills from "./Skills";
import Agents from "./Agents";
import Tasks from "./Tasks";
import { Planet } from "./planet";
import { IconBack, IconChat, IconFolder, IconMemory, IconSkill, IconAgent, IconTasks } from "./UniverseIcons";
import type { ProjectMeta } from "./Universe";

type TabKey = "sohbet" | "dosyalar" | "hafiza" | "beceriler" | "ajanlar" | "gorevler";
const TABS: { key: TabKey; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "sohbet", label: "Sohbet", Icon: IconChat },
  { key: "dosyalar", label: "Dosyalar", Icon: IconFolder },
  { key: "hafiza", label: "Hafıza", Icon: IconMemory },
  { key: "beceriler", label: "Beceriler", Icon: IconSkill },
  { key: "ajanlar", label: "Ajanlar", Icon: IconAgent },
  { key: "gorevler", label: "Görevler", Icon: IconTasks },
];

export default function ProjectView({ project, onClose }: { project: ProjectMeta; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("sohbet");
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && tab !== "sohbet") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, tab]);
  const scope = `c-${project.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}/`;

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col transition-[opacity,transform] duration-300 ease-out"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, rgba(17,27,48,.97), rgba(6,10,20,.99))",
        opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(.96)",
      }}
    >
      {/* başlık */}
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={onClose}
          className="flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px] transition-colors duration-150"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
          aria-label="Evrene dön"
        >
          <IconBack width={18} height={18} /> Evren
        </button>
        <Planet seed={project.id + project.title} size={32} spin={false} />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-bold">{project.title}</div>
          <div className="text-[12px]" style={{ color: "var(--text-muted)", letterSpacing: ".05em" }}>PROJE</div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* sekme rayı */}
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:px-2 sm:py-4"
          style={{ borderColor: "var(--border)" }}
          aria-label="Proje sekmeleri"
        >
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                aria-current={active ? "page" : undefined}
                title={label}
                className="flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[14px] transition-colors duration-150 sm:w-[132px]"
                style={{
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                }}
              >
                <Icon width={20} height={20} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* içerik */}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {/* Sohbet her zaman bağlı kalır (gizlenir) → sekme değişince yarıda kesilmez */}
          <div className="absolute inset-0 flex flex-col" hidden={tab !== "sohbet"}>
            <Chat conversationId={project.id} />
          </div>
          {tab === "dosyalar" && <div className="absolute inset-0 overflow-y-auto"><Files prefix={scope} /></div>}
          {tab === "hafiza" && <div className="absolute inset-0 overflow-y-auto"><ProjectMemory id={project.id} /></div>}
          {tab === "beceriler" && <div className="absolute inset-0 overflow-y-auto"><Skills /></div>}
          {tab === "ajanlar" && <div className="absolute inset-0 overflow-y-auto"><Agents onStartChat={() => setTab("sohbet")} /></div>}
          {tab === "gorevler" && <div className="absolute inset-0 overflow-y-auto"><Tasks /></div>}
        </main>
      </div>
    </div>
  );
}

// Projenin hafıza notları (yalnız bu projeye ait olanlar)
function ProjectMemory({ id }: { id: string }) {
  const [items, setItems] = useState<{ id: string; ts: number; summary: string; tags: string[] }[] | null>(null);
  useEffect(() => {
    fetch("/api/memory").then((r) => r.json()).then((d) => {
      const all = Array.isArray(d.memories) ? d.memories : [];
      setItems(all.filter((m: { scope?: string }) => m.scope === id).reverse());
    }).catch(() => setItems([]));
  }, [id]);
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-1 text-[20px] font-bold">Proje hafızası</div>
      <p className="mb-6 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Nova bu projede konuştukça önemli bilgileri buraya not eder. Bu notlar yalnız bu projede kullanılır.
      </p>
      {items === null ? (
        <div className="text-[14px]" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl p-6 text-[14px]" style={{ border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}>
          Henüz not yok.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((m) => (
            <li key={m.id} className="rounded-xl p-4" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div className="text-[14px] leading-relaxed">{m.summary}</div>
              <div className="mt-2 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {new Date(m.ts).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {m.tags?.length ? ` · ${m.tags.join(", ")}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
