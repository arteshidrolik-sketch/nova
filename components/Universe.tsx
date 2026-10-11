"use client";

// Evren: Nova'nın yeni ana ekranı (deneme). Her proje (eski "sohbet") uzayda
// yörüngede dönen bir gezegen. Gezegene tıklayınca proje sayfası açılır; yapay
// zekâ sohbeti ve proje sekmeleri orada. Yörünge hareketi requestAnimationFrame
// ile, yalnız transform/opacity; reduced-motion'da durur.
import { useCallback, useEffect, useRef, useState } from "react";
import SpaceBackground from "./SpaceBackground";
import ProjectView from "./ProjectView";
import { Planet } from "./planet";
import { IconPlus, IconClose } from "./UniverseIcons";
import SpaceControls from "./SpaceControls";

// Yörünge geometrisi: yatay ekranda geniş-basık elips (perspektif), dikey ekranda
// (telefon) daha yuvarlak ve geniş yörünge + küçük gezegenler → merkezle çakışmaz.
export function orbitGeometry(w: number, h: number) {
  const portrait = h > w * 1.1;
  const cx = w / 2, cy = h / 2 + h * 0.02;
  const ks = portrait ? [0.66, 0.84, 1.0] : [0.46, 0.72, 0.98];
  const base = portrait ? w * 0.37 : Math.min(w * 0.44, h * 0.95);
  const rings = ks.map((k) => ({ rx: base * k, ry: portrait ? h * 0.3 * k : base * k * 0.36 }));
  const psc = Math.max(0.58, Math.min(1, Math.min(w, h) / 760));
  return { cx, cy, rings, psc };
}

export type ProjectMeta = { id: string; title: string; updatedAt: number; pinned?: boolean };

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "şimdi";
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} gün önce` : new Date(ts).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export default function Universe() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [open, setOpen] = useState<ProjectMeta | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hover;
  const tRef = useRef(0); // yörünge zamanı — yeniden çizimlerde sıfırlanmaz
  const [coreSize, setCoreSize] = useState(132);
  useEffect(() => {
    const f = () => setCoreSize(Math.min(window.innerWidth, window.innerHeight) < 640 ? 92 : 136);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/conversations").then((r) => r.json());
      setProjects(Array.isArray(d.conversations) ? d.conversations : []);
    } catch { /* yoksay */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Yörünge yerleşimi: en yeni projeler iç yörüngede, daha büyük
  const layout = projects.map((p, i) => {
    const ring = i < 4 ? 0 : i < 10 ? 1 : 2;
    const inRing = projects.filter((_, j) => (j < 4 ? 0 : j < 10 ? 1 : 2) === ring);
    const idx = inRing.indexOf(p);
    return { p, ring, phase: (idx / Math.max(1, inRing.length)) * Math.PI * 2 + ring * 0.7, size: [96, 76, 60][ring] };
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Animasyon döngüsü: açıyı ilerlet, perspektifli elips üzerine yerleştir
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = performance.now(), running = true;
    const speeds = [0.06, 0.04, 0.028]; // rad/sn
    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!reduced && !hoverRef.current) tRef.current += dt;
      const t = tRef.current;
      const r = stage!.getBoundingClientRect();
      const G = orbitGeometry(r.width, r.height);
      for (const L of layoutRef.current) {
        const el = nodeRefs.current.get(L.p.id);
        if (!el) continue;
        const a = L.phase + t * speeds[L.ring];
        const s = Math.sin(a);
        const depth = (s + 1) / 2; // 0 arka … 1 ön
        const x = G.cx + Math.cos(a) * G.rings[L.ring].rx;
        const y = G.cy + s * G.rings[L.ring].ry;
        const sc = (0.72 + depth * 0.38 + (hoverRef.current === L.p.id ? 0.12 : 0)) * G.psc;
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc.toFixed(3)})`;
        // etiket gezegenle küçülse de okunur kalsın (etkin ölçek en az ~0.95)
        el.style.setProperty("--ls", Math.max(1, 0.95 / sc).toFixed(3));
        el.style.zIndex = String(s > 0 ? 30 + Math.round(depth * 20) : 5 + Math.round(depth * 5));
        el.style.opacity = String((0.55 + depth * 0.45).toFixed(3));
      }
    }
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { running = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  async function create() {
    const title = newName.trim();
    if (!title) return;
    const d = await fetch("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    }).then((r) => r.json()).catch(() => null);
    setCreating(false); setNewName("");
    await load();
    if (d?.conversation) setOpen({ id: d.conversation.id, title: d.conversation.title, updatedAt: Date.now() });
  }

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: "var(--bg)" }}>
      <SpaceBackground />

      {/* üst bar */}
      <header hidden={!!open} className="absolute left-0 right-0 top-0 z-[60] flex items-center justify-between px-4 py-4 sm:px-8">
        <div>
          <div className="text-[20px] font-bold tracking-tight">Nova <span style={{ color: "var(--accent)" }}>Evren</span></div>
          <div className="text-[12px]" style={{ color: "var(--text-muted)", letterSpacing: ".05em" }}>
            {projects.length} PROJE · BİR GEZEGEN SEÇ
          </div>
        </div>
        <div className="flex items-center gap-2">
        <SpaceControls />
        <button
          onClick={() => setCreating(true)}
          className="flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition-transform duration-200 hover:scale-[1.03]"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
        >
          <IconPlus width={18} height={18} /> <span className="hidden sm:inline">Yeni proje</span>
        </button>
        </div>
      </header>

      {/* sahne */}
      <div ref={stageRef} className="absolute inset-0">
        {/* yörünge çizgileri */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <OrbitRings />
        </svg>

        {/* merkez: Nova = Dünya (bulutlarıyla dönen) */}
        <div className="pointer-events-none absolute left-1/2 top-[51%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <Planet seed="nova-earth" size={coreSize} earth />
          <span className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ letterSpacing: ".2em", color: "var(--text)", background: "rgba(8,12,24,.72)", border: "1px solid var(--border-strong)" }}>NOVA</span>
        </div>

        {layout.map(({ p, size }) => (
          <button
            key={p.id}
            ref={(el) => { if (el) nodeRefs.current.set(p.id, el); else nodeRefs.current.delete(p.id); }}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover((h) => (h === p.id ? null : h))}
            onClick={() => setOpen(p)}
            aria-label={`${p.title} projesini aç`}
            className="group absolute left-0 top-0 flex flex-col items-center gap-2 outline-none"
            style={{ willChange: "transform" }}
          >
            <Planet seed={p.id + p.title} size={size} />
            <span
              className="max-w-[160px] truncate rounded-full px-3 py-1 text-[12px] font-medium transition-opacity duration-200"
              style={{
                background: "rgba(8,12,24,.72)", border: `1px solid ${hover === p.id ? "var(--accent)" : "var(--border)"}`,
                color: "var(--text)", backdropFilter: "blur(6px)",
                transform: "scale(var(--ls, 1))", transformOrigin: "50% 0",
              }}
            >
              {p.title}
            </span>
            {hover === p.id && (
              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{ago(p.updatedAt)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-3 z-[60] text-[11px]" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
        Gezegen dokuları: Solar System Scope (CC BY 4.0)
      </div>

      {/* yeni proje kutusu */}
      {creating && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(3,6,14,.6)" }} onClick={() => setCreating(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); create(); }}
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border-strong)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[16px] font-bold">Yeni proje gezegeni</div>
              <button type="button" onClick={() => setCreating(false)} aria-label="Kapat" className="flex h-11 w-11 items-center justify-center rounded-full" style={{ color: "var(--text-muted)" }}>
                <IconClose width={18} height={18} />
              </button>
            </div>
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Proje adı"
              className="h-11 w-full rounded-xl px-4 text-[16px] outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
            />
            <button type="submit" disabled={!newName.trim()} className="mt-4 h-11 w-full rounded-xl text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#04141f" }}>
              Oluştur ve aç
            </button>
          </form>
        </div>
      )}

      {/* proje sayfası */}
      {open && (
        <ProjectView project={open} onClose={() => { setOpen(null); load(); }} />
      )}
    </div>
  );
}

// Üç yörünge elipsi (sahne boyutuna göre ölçeklenir)
function OrbitRings() {
  const [s, setS] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const f = () => setS({ w: window.innerWidth, h: window.innerHeight });
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  if (!s.w) return null;
  const G = orbitGeometry(s.w, s.h);
  return (
    <g fill="none" stroke="rgba(148,180,255,.14)" strokeWidth={1}>
      {G.rings.map((r, i) => (
        <ellipse key={i} cx={G.cx} cy={G.cy} rx={r.rx} ry={r.ry} strokeDasharray="2 6" />
      ))}
    </g>
  );
}
