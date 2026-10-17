"use client";

// Proje sayfası: bir gezegene tıklayınca açılır. Sol ikon rayı (mobilde üstte)
// ile sekmeler: Sohbet (bu projenin yapay zekâ sohbeti), Dosyalar (yalnız bu
// projenin klasörü), Hafıza (yalnız bu projenin notları), Beceriler, Ajanlar,
// Görevler. Sohbet, projenin kendi conversationId'si ile çalışır → yalıtılmış.
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import Chat from "./Chat";
import Files from "./Files";
import Skills from "./Skills";
import Tasks from "./Tasks";
import Invoices from "./Invoices";
import TeamOffice, { prefetchOffices } from "./TeamOffice";
import AgentMonitor from "./AgentMonitor";
import SpaceControls from "./SpaceControls";
import NovaCost from "./NovaCost";
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

export default function ProjectView({ project, projects = [], onSwitch, onRenamed, onClose, instant = false }: {
  project: ProjectMeta; projects?: ProjectMeta[]; onSwitch?: (p: ProjectMeta) => void; onClose: () => void;
  onRenamed?: (id: string, title: string) => void;
  instant?: boolean; // sekmeyle geçişte giriş animasyonu yok (görüntü bir an kaybolmasın)
}) {
  // tüm projelerin kamera bilgilerini önceden yükle → sekme geçişi anında
  useEffect(() => { prefetchOffices(projects.map((p) => p.id)); }, [projects]);
  const [tab, setTab] = useState<TabKey>("sohbet");
  // Nova sesli komutu: "dosyalar sekmesini aç" vb.
  useEffect(() => {
    const onTab = (e: Event) => { const k = (e as CustomEvent<TabKey>).detail; if (TABS.some((t) => t.key === k)) setTab(k); };
    window.addEventListener("nova:tab", onTab);
    return () => window.removeEventListener("nova:tab", onTab);
  }, []);
  // sürüklenebilir yerleşim (kamera yüksekliği, sağ panel genişliği) — tarayıcıda saklanır
  const [layout, setLayout] = useState<typeof DEFAULT_LAYOUT>(() => {
    try { const v = JSON.parse(localStorage.getItem("nova:layout") || "null"); if (v && typeof v.camH === "number" && typeof v.panelW === "number") return v; } catch { /* yoksay */ }
    return DEFAULT_LAYOUT;
  });
  useEffect(() => { try { localStorage.setItem("nova:layout", JSON.stringify(layout)); } catch { /* yoksay */ } }, [layout]);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const f = () => setCompact(window.innerWidth < 760 || window.innerHeight < 760);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const [shown, setShown] = useState(instant);
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
      <PageAnim />
      {/* başlık */}
      <header className="relative z-[1] flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--border-strong)", background: "var(--surface-header)" }}>
        <button
          onClick={onClose}
          className="flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px] transition-colors duration-150"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
          aria-label="Evrene dön"
        >
          <IconBack width={18} height={18} /> Evren
        </button>
        {/* proje sekmeleri: evrene dönmeden projeler arasında geçiş */}
        <ProjectTabs project={project} projects={projects} onSwitch={onSwitch} onRenamed={onRenamed} />
        <NovaCost />
        <SpaceControls />
      </header>

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col sm:flex-row">
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
          <div className="absolute inset-0 flex" hidden={tab !== "sohbet"}>
            {/* sol: ofis + sohbet */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0" style={{ background: "var(--surface-office)" }}>
                <TeamOffice convId={project.id} title={project.title} compact={compact} height={layout.camH} />
              </div>
              {/* sürükle: kamera yüksekliği */}
              <Splitter dir="y" title="Sürükle: kamera yüksekliği · çift tık: varsayılan"
                onDrag={(d) => setLayout((l) => ({ ...l, camH: clamp(l.camH + d, 90, 560) }))}
                onReset={() => setLayout((l) => ({ ...l, camH: DEFAULT_LAYOUT.camH }))} />
              <div className="surface-dark relative min-h-0 flex-1">
                <div className="absolute inset-0 flex flex-col"><Chat conversationId={project.id} speakerGender="k" /></div>
              </div>
            </div>
            {/* sürükle: sağ panel genişliği */}
            <div className="hidden lg:flex">
              <Splitter dir="x" title="Sürükle: panel genişliği · çift tık: varsayılan"
                onDrag={(d) => setLayout((l) => ({ ...l, panelW: clamp(l.panelW - d, 240, 760) }))}
                onReset={() => setLayout((l) => ({ ...l, panelW: DEFAULT_LAYOUT.panelW }))} />
            </div>
            {/* sağ: ajan performansı (geniş ekranda) */}
            <div className="hidden shrink-0 lg:block" style={{ width: layout.panelW }}>
              <AgentMonitor convId={project.id} />
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
      <BriefEditor id={id} />
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
      <YouTubeCard id={id} />
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

// Sayfa arka planı: yavaşça gezinen renkli ışık lekeleri + yukarı süzülen parçacıklar
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100, size: 1 + (i % 3), dur: 18 + ((i * 7) % 16), delay: -((i * 5.3) % 30),
}));
function PageAnim() {
  return (
    <div className="page-anim" aria-hidden>
      <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
      {PARTICLES.map((p, i) => (
        <span key={i} className="p" style={{ left: `${p.left}%`, width: p.size, height: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }} />
      ))}
    </div>
  );
}

// Proje adını değiştir (sunucuda kalıcı; sesli komutlar da yeni adı tanır)
async function renameProject(id: string, title: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    return r.ok;
  } catch { return false; }
}

// Sekme çubuğundaki projeler (sıra = kullanıcının seçtiği sıra) — tarayıcıda saklanır.
// Kayıt yoksa son çalışılan 6 proje. Açık proje çubukta yoksa geçici olarak sona eklenir.
const TABS_KEY = "nova:tabs";
const DEFAULT_TABS = 6;
function loadTabIds(): string[] | null {
  try { const v = JSON.parse(localStorage.getItem(TABS_KEY) || "null"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null; } catch { return null; }
}

// Üst çubukta proje sekmeleri: çift tıkla yeniden adlandır, × ile çubuktan kaldır,
// "Tümü" menüsünden ara / sekmeye ekle / adlandır. Çubuk taşarsa fare tekerleğiyle yatay kayar.
function ProjectTabs({ project, projects, onSwitch, onRenamed }: { project: ProjectMeta; projects: ProjectMeta[]; onSwitch?: (p: ProjectMeta) => void; onRenamed?: (id: string, title: string) => void }) {
  const all = projects.some((p) => p.id === project.id) ? projects : [project, ...projects];
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => { setIds(loadTabIds()); }, []);
  const saveIds = (next: string[]) => { setIds(next); try { localStorage.setItem(TABS_KEY, JSON.stringify(next)); } catch { /* yoksay */ } };
  const byId = new Map(all.map((p) => [p.id, p]));
  const base = ids ? ids.filter((id) => byId.has(id)) : all.slice(0, DEFAULT_TABS).map((p) => p.id);
  const onBar = (id: string) => base.includes(id);
  const shown = [...base, ...(onBar(project.id) ? [] : [project.id])].map((id) => byId.get(id)!).filter(Boolean);
  const toggleBar = (id: string) => saveIds(onBar(id) ? base.filter((x) => x !== id) : [...base, id]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const doneRef = useRef(false); // Enter + blur aynı düzenlemeyi iki kez kaydetmesin
  const startEdit = (p: ProjectMeta) => { doneRef.current = false; setEditing(p.id); setDraft(p.title); };
  const commit = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const id = editing; const t = draft.trim();
    setEditing(null);
    if (!id || !t || t === byId.get(id)?.title) return;
    onRenamed?.(id, t); // anında göster
    if (!(await renameProject(id, t))) alert("Ad kaydedilemedi, tekrar dene.");
  };
  const editBox = (
    <input
      autoFocus value={draft} maxLength={60}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="w-[150px] rounded-md bg-black/40 px-1.5 py-0.5 text-[13px] outline-none"
      style={{ border: "1px solid rgba(255,255,255,.35)", color: "var(--text)" }}
    />
  );

  const barRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [project.id]);
  useEffect(() => {
    const el = barRef.current; if (!el) return;
    const w = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
    el.addEventListener("wheel", w, { passive: false });
    return () => el.removeEventListener("wheel", w);
  }, []);

  // Tümü menüsü
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const d = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) { setMenu(false); setEditing(null); } };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", d); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", d); window.removeEventListener("keydown", k); };
  }, [menu]);
  const nq = q.toLocaleLowerCase("tr-TR").trim();
  const found = nq ? all.filter((p) => p.title.toLocaleLowerCase("tr-TR").includes(nq)) : all;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <nav ref={barRef} className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-label="Projeler">
        {shown.map((p) => {
          const active = p.id === project.id;
          return (
            <div
              key={p.id}
              ref={active ? activeRef : undefined}
              role="button" tabIndex={0}
              onClick={() => !active && editing !== p.id && onSwitch?.(p)}
              onDoubleClick={() => startEdit(p)}
              onKeyDown={(e) => { if (e.key === "Enter" && !active && editing !== p.id) onSwitch?.(p); if (e.key === "F2") startEdit(p); }}
              aria-current={active ? "page" : undefined}
              title={`${p.title} — çift tıkla: yeniden adlandır`}
              className="group flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full pl-1.5 pr-2 text-[13px] transition-colors duration-150"
              style={{
                background: active ? "rgba(255,255,255,.14)" : "transparent",
                border: `1px solid ${active ? "rgba(255,255,255,.35)" : "transparent"}`,
                color: active ? "var(--text)" : "var(--text-muted)",
                fontWeight: active ? 700 : 500,
              }}
            >
              <Planet seed={p.id + p.title} size={24} spin={false} />
              {editing === p.id ? editBox : <span className="max-w-[160px] truncate">{p.title}</span>}
              {editing !== p.id && onBar(p.id) && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleBar(p.id); }}
                  title="Sekme çubuğundan kaldır (proje silinmez)"
                  aria-label={`${p.title} sekmesini kaldır`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[12px] opacity-0 hover:bg-white/15 group-hover:opacity-70"
                >×</button>
              )}
              {editing !== p.id && !onBar(p.id) && <span className="w-1" />}
            </div>
          );
        })}
      </nav>
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => { setMenu((m) => !m); setQ(""); }}
          aria-expanded={menu}
          title="Tüm projeler: ara, sekmeye ekle, yeniden adlandır"
          className="flex h-10 items-center gap-1 rounded-full px-3 text-[13px]"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
        >
          Tümü <span className="opacity-70">({all.length})</span> ▾
        </button>
        {menu && (
          <div
            className="absolute right-0 top-12 z-[200] w-[320px] max-w-[90vw] rounded-xl p-2 shadow-2xl"
            style={{ background: "rgba(14,17,40,.97)", border: "1px solid var(--border-strong)", backdropFilter: "blur(8px)" }}
          >
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proje ara…"
              onKeyDown={(e) => { if (e.key === "Enter" && found[0]) { onSwitch?.(found[0]); setMenu(false); } }}
              className="mb-2 w-full rounded-lg bg-black/40 px-3 py-2 text-[13px] outline-none"
              style={{ border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <div className="max-h-[60vh] overflow-y-auto">
              {found.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <button
                    onClick={() => toggleBar(p.id)}
                    title={onBar(p.id) ? "Sekme çubuğundan kaldır" : "Sekme çubuğuna ekle"}
                    className="w-5 text-[15px]"
                    style={{ color: onBar(p.id) ? "#ffd166" : "var(--text-muted)" }}
                  >{onBar(p.id) ? "★" : "☆"}</button>
                  <Planet seed={p.id + p.title} size={20} spin={false} />
                  {editing === p.id ? editBox : (
                    <button
                      onClick={() => { if (p.id !== project.id) onSwitch?.(p); setMenu(false); }}
                      className="min-w-0 flex-1 truncate text-left text-[13px]"
                      style={{ color: p.id === project.id ? "var(--text)" : "var(--text-muted)", fontWeight: p.id === project.id ? 700 : 500 }}
                    >{p.title}</button>
                  )}
                  {editing !== p.id && (
                    <button onClick={() => startEdit(p)} title="Yeniden adlandır" aria-label={`${p.title} adını değiştir`} className="rounded px-1 text-[13px] opacity-60 hover:opacity-100">✏️</button>
                  )}
                </div>
              ))}
              {found.length === 0 && <div className="px-2 py-3 text-[13px]" style={{ color: "var(--text-muted)" }}>Eşleşen proje yok.</div>}
            </div>
            <div className="mt-2 border-t px-2 pt-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              ★ sekme çubuğunda · çubukta çift tıkla = yeniden adlandır
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Proje kimliği: müdür ve uzmanlar her görevde bunu okur (amaç, kitle, kurallar, durum, hedef)
function BriefEditor({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [state, setState] = useState<"" | "saving" | "ok" | "err">("");
  useEffect(() => {
    fetch(`/api/team/brief?scope=${encodeURIComponent(id)}`).then((r) => r.json())
      .then((d) => { setText(d.brief ?? ""); setSaved(d.brief ?? ""); }).catch(() => setText(""));
  }, [id]);
  const save = async () => {
    if (text === null) return;
    setState("saving");
    try {
      const r = await fetch(`/api/team/brief?scope=${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: text }) });
      if (!r.ok) throw new Error();
      setSaved(text); setState("ok");
    } catch { setState("err"); }
  };
  const dirty = text !== null && text !== saved;
  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[20px] font-bold">Proje kimliği</div>
        <button
          onClick={save} disabled={!dirty || state === "saving"}
          className="rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
          style={{ background: "var(--grad)", color: "#0b1030" }}
        >
          {state === "saving" ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
      <p className="mb-3 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Müdür ve uzmanlar her görevde bunu okur: projenin amacı, kitlesi, kuralları, güncel durumu ve hedefleri.
        {state === "ok" && !dirty && <span style={{ color: "#2ff5b5" }}> · Kaydedildi</span>}
        {state === "err" && <span style={{ color: "#ff6b7a" }}> · Kaydedilemedi</span>}
      </p>
      <textarea
        value={text ?? ""} onChange={(e) => { setText(e.target.value); setState(""); }}
        placeholder={text === null ? "Yükleniyor…" : "Henüz kimlik yok. Projeyi birkaç paragrafla anlat: ne, kimin için, kurallar, şu anki durum, hedef."}
        rows={14}
        className="w-full rounded-xl p-3 font-mono text-[13px] leading-relaxed outline-none"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", resize: "vertical" }}
      />
    </section>
  );
}

// YouTube kanal kartı (Raporlar): bağlı kanalın rakamları, 24 saat / 7 gün değişimi,
// izlenme grafiği ve öne çıkan videolar. Bağlı değilse bağlama kutusu.
type YtVid = { id: string; title: string; publishedAt: string; views: number; likes: number };
type YtData = {
  link: { channelId: string; title: string; handle?: string } | null; hasKey?: boolean;
  latest?: { ts: number; subs: number; views: number; videoCount: number; videos: YtVid[] } | null;
  series?: { ts: number; subs: number; views: number }[];
};
function YouTubeCard({ id }: { id: string }) {
  const [d, setD] = useState<YtData | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => fetch(`/api/youtube?scope=${encodeURIComponent(id)}`).then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (method: "POST" | "PUT") => {
    setBusy(true); setErr("");
    const r = await fetch(`/api/youtube?scope=${encodeURIComponent(id)}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ channel: input }) : undefined }).then((x) => x.json()).catch(() => ({ error: "bağlantı hatası" }));
    if (r.error) setErr(r.error); else await load();
    setBusy(false);
  };
  if (!d) return null;
  const n = (x: number) => x.toLocaleString("tr-TR");
  const box = { background: "var(--bg-panel)", border: "1px solid var(--border)" };
  if (!d.link) {
    return (
      <div className="mb-6 rounded-xl p-4" style={box}>
        <div className="mb-1 text-[15px] font-bold">YouTube kanalı</div>
        <p className="mb-3 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Kanalı bağla; Nova 6 saatte bir rakamları ölçer, ekip gelişmeyi her görevde görür.
          {!d.hasKey && <span style={{ color: "#ffb547" }}> Sunucuda YouTube anahtarı henüz yok.</span>}
        </p>
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@kanaladi, kanal bağlantısı ya da bir video bağlantısı"
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          <button onClick={() => act("POST")} disabled={busy || !input.trim()} className="rounded-lg px-3 py-2 text-[13px] font-medium disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
            {busy ? "Bağlanıyor…" : "Bağla"}
          </button>
        </div>
        {err && <div className="mt-2 text-[12px]" style={{ color: "#ff6b7a" }}>{err}</div>}
      </div>
    );
  }
  const L = d.latest, S = d.series ?? [];
  const ago = (ms: number) => { const t = Date.now() - ms; for (let i = S.length - 1; i >= 0; i--) if (S[i].ts <= t) return S[i]; return null; };
  const day = ago(20 * 3600e3), week = ago(6.5 * 86400e3);
  const delta = (a: number, b?: number) => (b === undefined ? null : a - b);
  const Chip = ({ v }: { v: number | null }) => v === null ? null : <span className="text-[11px]" style={{ color: v > 0 ? "#2ff5b5" : v < 0 ? "#ff6b7a" : "var(--text-muted)" }}>{v > 0 ? "+" : ""}{n(v)}</span>;
  // izlenme grafiği (basit çizgi)
  const pts = S.slice(-60);
  const minV = Math.min(...pts.map((p) => p.views)), maxV = Math.max(...pts.map((p) => p.views));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(i / Math.max(1, pts.length - 1)) * 300},${58 - ((p.views - minV) / Math.max(1, maxV - minV)) * 52}`).join(" ");
  const top = [...(L?.videos ?? [])].sort((a, b) => b.views - a.views).slice(0, 5);
  return (
    <div className="mb-6 rounded-xl p-4" style={box}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-bold">YouTube · {d.link.title} <span className="text-[12px] font-normal" style={{ color: "var(--text-muted)" }}>{d.link.handle}</span></div>
        <button onClick={() => act("PUT")} disabled={busy} className="text-[12px] underline disabled:opacity-40" style={{ color: "var(--text-muted)" }}>{busy ? "ölçülüyor…" : "şimdi ölç"}</button>
      </div>
      {L && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[["Abone", L.subs, day?.subs, week?.subs], ["İzlenme", L.views, day?.views, week?.views], ["Video", L.videoCount, undefined, undefined]].map(([label, v, dd, ww]) => (
              <div key={label as string}>
                <div className="text-[22px] font-semibold tabular-nums">{n(v as number)}</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label as string}</div>
                <div className="flex justify-center gap-2">{dd !== undefined && <span>24s <Chip v={delta(v as number, dd as number)} /></span>}{ww !== undefined && <span>7g <Chip v={delta(v as number, ww as number)} /></span>}</div>
              </div>
            ))}
          </div>
          {pts.length > 1 && (
            <svg viewBox="0 0 300 60" className="mt-3 h-[60px] w-full" preserveAspectRatio="none" aria-label="İzlenme gelişimi">
              <path d={path} fill="none" stroke="#2ff5b5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <div className="mt-3 text-[12px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".06em" }}>En çok izlenenler</div>
          <ul className="mt-1 flex flex-col gap-1 text-[13px]">
            {top.map((v) => (
              <li key={v.id} className="flex justify-between gap-3">
                <a href={`https://youtube.com/shorts/${v.id}`} target="_blank" rel="noreferrer" className="truncate hover:underline">{v.title}</a>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>{n(v.views)} izl · {n(v.likes)} ♥</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Son ölçüm {new Date(L.ts).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · Nova 6 saatte bir ölçer · {S.length} kayıt
          </div>
        </>
      )}
      {err && <div className="mt-2 text-[12px]" style={{ color: "#ff6b7a" }}>{err}</div>}
    </div>
  );
}

const DEFAULT_LAYOUT = { camH: 220, panelW: 380 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Sürükleme çubuğu: dir="y" yatay çubuk (yükseklik), dir="x" dikey çubuk (genişlik)
function Splitter({ dir, onDrag, onReset, title }: { dir: "x" | "y"; onDrag: (delta: number) => void; onReset: () => void; title: string }) {
  const last = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      role="separator" aria-orientation={dir === "y" ? "horizontal" : "vertical"} title={title}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); last.current = dir === "y" ? e.clientY : e.clientX; setActive(true); document.body.style.userSelect = "none"; }}
      onPointerMove={(e) => { if (last.current === null) return; const p = dir === "y" ? e.clientY : e.clientX; const d = p - last.current; if (d) { onDrag(d); last.current = p; } }}
      onPointerUp={() => { last.current = null; setActive(false); document.body.style.userSelect = ""; }}
      onPointerCancel={() => { last.current = null; setActive(false); document.body.style.userSelect = ""; }}
      onDoubleClick={onReset}
      className={`group relative z-[6] shrink-0 touch-none ${dir === "y" ? "h-2 w-full cursor-row-resize" : "h-full w-2 cursor-col-resize"}`}
      style={{ background: active ? "rgba(62,232,255,.35)" : "var(--border-strong)" }}
    >
      <span
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity ${dir === "y" ? "h-1 w-10" : "h-10 w-1"} ${active ? "opacity-100" : "opacity-50 group-hover:opacity-100"}`}
        style={{ background: "#e5e7eb" }}
      />
    </div>
  );
}
