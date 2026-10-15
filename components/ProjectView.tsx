"use client";

// Proje sayfası: bir gezegene tıklayınca açılır. Sol ikon rayı (mobilde üstte)
// ile sekmeler: Sohbet (bu projenin yapay zekâ sohbeti), Dosyalar (yalnız bu
// projenin klasörü), Hafıza (yalnız bu projenin notları), Beceriler, Ajanlar,
// Görevler. Sohbet, projenin kendi conversationId'si ile çalışır → yalıtılmış.
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import Chat from "./Chat";
import Files from "./Files";
import Skills from "./Skills";
import Tasks from "./Tasks";
import Invoices from "./Invoices";
import TeamOffice from "./TeamOffice";
import SpaceControls from "./SpaceControls";
import { Planet } from "./planet";
import { IconBack, IconFolder, IconMemory, IconSkill, IconAgent, IconTasks, IconReport, IconInvoice } from "./UniverseIcons";
import type { ProjectMeta } from "./Universe";

type TabKey = "sohbet" | "dosyalar" | "fatura" | "hafiza" | "raporlar" | "beceriler" | "gorevler";
const TABS: { key: TabKey; label: string; color: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "sohbet", label: "Ekip", color: "#3ee8ff", Icon: IconAgent },
  { key: "dosyalar", label: "Dosyalar", color: "#ffd166", Icon: IconFolder },
  { key: "fatura", label: "Fatura", color: "#7ee8a2", Icon: IconInvoice },
  { key: "hafiza", label: "Hafıza", color: "#ff7ad9", Icon: IconMemory },
  { key: "raporlar", label: "Raporlar", color: "#2ff5b5", Icon: IconReport },
  { key: "beceriler", label: "Beceriler", color: "#b39bff", Icon: IconSkill },
  { key: "gorevler", label: "Onaylar", color: "#ff9f6b", Icon: IconTasks },
];

export default function ProjectView({ project, onClose }: { project: ProjectMeta; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("sohbet");
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const f = () => setCompact(window.innerWidth < 760 || window.innerHeight < 760);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
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
        background: "radial-gradient(900px 500px at 0% 0%, rgba(139,92,255,.30), transparent 60%), radial-gradient(800px 500px at 100% 0%, rgba(255,79,200,.18), transparent 60%), radial-gradient(900px 600px at 50% 110%, rgba(62,232,255,.16), transparent 60%), linear-gradient(160deg, #1d2358, #171c48 60%, #1b1749)",
        opacity: shown ? 1 : 0, transform: shown ? "scale(1)" : "scale(.96)",
      }}
    >
      {/* başlık */}
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--border-strong)", background: "var(--surface-header)" }}>
        <button
          onClick={onClose}
          className="flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px] transition-colors duration-150"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
          aria-label="Evrene dön"
        >
          <IconBack width={18} height={18} /> Evren
        </button>
        <Planet seed={project.id + project.title} size={32} spin={false} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-bold">{project.title}</div>
          <div className="text-[12px] font-medium" style={{ color: "#ffb4e6", letterSpacing: ".05em" }}>PROJE · MÜDÜR + 3 UZMAN</div>
        </div>
        <SpaceControls />
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* sekme rayı */}
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:px-2 sm:py-4"
          style={{ borderColor: "var(--border-strong)", background: "var(--surface-rail)" }}
          aria-label="Proje sekmeleri"
        >
          {TABS.map(({ key, label, color, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                aria-current={active ? "page" : undefined}
                title={label}
                className="flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[14px] transition-colors duration-150 sm:w-[132px]"
                style={{
                  background: active ? "var(--grad)" : "transparent",
                  color: active ? "#0b1030" : "#d5dbff",
                  fontWeight: active ? 700 : 500,
                  border: `1px solid ${active ? "transparent" : "transparent"}`,
                  boxShadow: active ? "0 6px 20px rgba(139,92,255,.35)" : "none",
                }}
              >
                <Icon width={20} height={20} style={{ color: active ? "#0b1030" : color }} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* içerik */}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {/* Ekip: üstte ofis (masa başındaki ajanlar), altta müdürle sohbet.
              Her zaman bağlı kalır (gizlenir) → sekme değişince iş yarıda kesilmez */}
          <div className="absolute inset-0 flex flex-col" hidden={tab !== "sohbet"}>
            <div className="shrink-0 border-b" style={{ borderColor: "var(--border-strong)", background: "var(--surface-office)" }}>
              <TeamOffice convId={project.id} compact={compact} />
            </div>
            <div className="surface-light relative min-h-0 flex-1">
              <div className="absolute inset-0 flex flex-col"><Chat conversationId={project.id} /></div>
            </div>
          </div>
          {tab === "dosyalar" && <div className="absolute inset-0 overflow-y-auto"><Files prefix={scope} /></div>}
          {tab === "hafiza" && <div className="absolute inset-0 overflow-y-auto"><ProjectMemory id={project.id} /></div>}
          {tab === "beceriler" && <div className="absolute inset-0 overflow-y-auto"><Skills /></div>}
          {tab === "fatura" && <div className="absolute inset-0 overflow-y-auto"><Invoices scope={project.id} /></div>}
          {tab === "raporlar" && <div className="absolute inset-0 overflow-y-auto"><ProjectReports id={project.id} /></div>}
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

// Gün sonu raporları (müdürün her akşam 18:00'de bu projeye yazdıkları)
function ProjectReports({ id }: { id: string }) {
  const [items, setItems] = useState<string[] | null>(null);
  useEffect(() => {
    fetch(`/api/conversations/${id}`).then((r) => r.json()).then((d) => {
      const msgs = (d.conversation?.messages ?? []) as { role: string; content: string }[];
      setItems(msgs.filter((m) => m.role === "assistant" && String(m.content).startsWith("📋 **Gün sonu")).map((m) => m.content).reverse());
    }).catch(() => setItems([]));
  }, [id]);
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-1 text-[20px] font-bold">Gün sonu raporları</div>
      <p className="mb-6 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Müdür her gün 18:00'de, o gün üzerinde çalışılan projeler için ilerleme raporu yazar. Raporlar sohbette de görünür.
      </p>
      <ModelDecisions id={id} />
      {items === null ? (
        <div className="text-[14px]" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl p-6 text-[14px]" style={{ border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}>
          Henüz rapor yok. Bu projede bugün çalışılırsa ilk rapor 18:00'de gelir.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((t, i) => (
            <li key={i} className="whitespace-pre-wrap rounded-xl p-4 text-[14px] leading-relaxed" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              {t.replace(/\*\*/g, "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Müdürün model seçimleri (son 30 gün): hangi işe hangi seviye, revizyon, süre, maliyet
type LogEntry = { ts: number; role: string; person: string; chosen: string; tier: string; revision: number; task: string; sec: number; costUsd: number };
const TIER_LABEL: Record<string, string> = { hafif: "Haiku", standart: "Sonnet", agir: "Opus" };
const TIER_COLOR: Record<string, string> = { hafif: "#2ff5b5", standart: "#7aa2ff", agir: "#ff7ad9" };
function ModelDecisions({ id }: { id: string }) {
  const [d, setD] = useState<{ entries: LogEntry[]; flags: string[]; costUsd: number } | null>(null);
  useEffect(() => {
    fetch(`/api/team/log?scope=${encodeURIComponent(id)}&days=30`).then((r) => r.json()).then(setD).catch(() => setD({ entries: [], flags: [], costUsd: 0 }));
  }, [id]);
  if (!d || d.entries.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl p-4" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-bold">Model kararları <span className="text-[12px] font-normal" style={{ color: "var(--text-muted)" }}>son 30 gün</span></div>
        <div className="text-[13px]" style={{ color: "var(--text-muted)" }}>{d.entries.length} çalışma · ~${d.costUsd.toFixed(3)}</div>
      </div>
      {d.flags.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-[13px]">{d.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr><th className="py-1 pr-3">Tarih</th><th className="pr-3">Uzman</th><th className="pr-3">Seviye</th><th className="pr-3">İş</th><th className="pr-3 text-right">Süre</th><th className="text-right">$</th></tr>
          </thead>
          <tbody>
            {d.entries.slice(0, 40).map((e, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="whitespace-nowrap py-1 pr-3">{new Date(e.ts).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="whitespace-nowrap pr-3">{e.person}</td>
                <td className="whitespace-nowrap pr-3">
                  <span style={{ color: TIER_COLOR[e.tier] }}>{TIER_LABEL[e.tier] ?? e.tier}</span>
                  {e.tier !== e.chosen && <span style={{ color: "var(--text-muted)" }}> (↑{TIER_LABEL[e.chosen]})</span>}
                  {e.revision > 0 && <span style={{ color: "var(--text-muted)" }}> · rev {e.revision}</span>}
                </td>
                <td className="max-w-[280px] truncate pr-3" title={e.task}>{e.task}</td>
                <td className="whitespace-nowrap pr-3 text-right">{e.sec} sn</td>
                <td className="whitespace-nowrap text-right">{e.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
