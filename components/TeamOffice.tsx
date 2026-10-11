"use client";

// Proje ofisi: 4 çalışma masası (Müdür, Araştırma, Kod, Satış & Pazarlama).
// Her ajan bilgisayarının başında oturur; durumunu sohbet akışından okur
// ("nova:stream" olayı): çalışıyor → ekranında satırlar akar, elleri klavyede;
// müdür denetliyor/konuşuyor → farklı gösterge. Masaya tıklayınca ajanın
// becerileri açılır; beceri eklenip çıkarılabilir.
import { useEffect, useState } from "react";
import { TEAM_META, TEAM_ROLES, type TeamRole } from "@/lib/team/roles";
import { IconClose, IconPlus } from "./UniverseIcons";

type Status = "idle" | "thinking" | "working" | "reviewing" | "done" | "speaking";
const STATUS_TR: Record<Status, string> = {
  idle: "Boşta", thinking: "Planlıyor", working: "Çalışıyor", reviewing: "Denetliyor", done: "Teslim etti", speaking: "Konuşuyor",
};

// Akış metninden rol durumlarını çıkar
function parseStatuses(text: string, running: boolean): Record<TeamRole, Status> {
  const st: Record<TeamRole, Status> = { manager: running ? "thinking" : "idle", research: "idle", coder: "idle", marketing: "idle" };
  const nameToRole = new Map<string, TeamRole>(TEAM_ROLES.map((r) => [TEAM_META[r].name, r]));
  let lastEvent: "work" | "done" | null = null;
  for (const line of text.split("\n")) {
    const w = line.match(/^👥 (.+?) çalışıyor/);
    const d = line.match(/^👥 (.+?) teslim etti/);
    const m = w || d;
    if (!m) continue;
    const role = nameToRole.get(m[1]);
    if (!role) continue;
    st[role] = w ? "working" : "done";
    lastEvent = w ? "work" : "done";
  }
  if (!running) {
    for (const r of TEAM_ROLES) if (st[r] === "working") st[r] = "done";
  } else {
    st.manager = lastEvent === "work" ? "thinking" : lastEvent === "done" ? "reviewing" : "thinking";
  }
  return st;
}

export default function TeamOffice({ convId, compact = false }: { convId: string; compact?: boolean }) {
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState<TeamRole | null>(null);

  useEffect(() => {
    const onStream = (e: Event) => {
      const d = (e as CustomEvent<{ convId: string; text: string; running: boolean }>).detail;
      if (!d || d.convId !== convId) return;
      setText(d.text); setRunning(d.running);
    };
    const onVoice = (e: Event) => setSpeaking((e as CustomEvent<string>).detail === "speaking");
    window.addEventListener("nova:stream", onStream);
    window.addEventListener("nova:voice", onVoice);
    return () => { window.removeEventListener("nova:stream", onStream); window.removeEventListener("nova:voice", onVoice); };
  }, [convId]);

  const st = parseStatuses(text, running);
  if (speaking && !running) st.manager = "speaking";

  return (
    <div className="relative w-full">
      <div
        className={`flex w-full items-end justify-center gap-2 overflow-x-auto px-3 sm:gap-6 ${compact ? "py-2" : "py-4"}`}
        role="list" aria-label="Proje ekibi"
      >
        {(["research", "manager", "coder", "marketing"] as TeamRole[]).map((r) => (
          <button
            key={r} role="listitem" onClick={() => setOpen(r)}
            className="group flex shrink-0 flex-col items-center gap-1 rounded-2xl p-1 outline-none transition-transform duration-200 hover:-translate-y-1 focus-visible:-translate-y-1"
            aria-label={`${TEAM_META[r].name} — ${STATUS_TR[st[r]]}. Becerileri aç`}
          >
            <Desk role={r} status={st[r]} size={compact ? 118 : r === "manager" ? 176 : 150} />
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{TEAM_META[r].name}</span>
              <span
                className="rounded-full px-2 py-[2px] text-[11px] font-medium"
                style={{
                  color: st[r] === "idle" ? "var(--text-muted)" : "#06121d",
                  background: st[r] === "idle" ? "rgba(148,180,255,.08)" : st[r] === "done" ? "#7ee2b8" : TEAM_META[r].color,
                }}
              >
                {STATUS_TR[st[r]]}
              </span>
            </div>
          </button>
        ))}
      </div>
      {open && <AgentPanel role={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---- Masa + ajan (SVG) ----
function Desk({ role, status, size }: { role: TeamRole; status: Status; size: number }) {
  const c = TEAM_META[role].color;
  const busy = status === "working" || status === "thinking" || status === "reviewing" || status === "speaking";
  const typing = status === "working";
  const hair = { manager: "#2b2118", research: "#5a3a22", coder: "#14161c", marketing: "#7a3b1d" }[role];
  const skin = { manager: "#e8b98f", research: "#f1c8a0", coder: "#c98e62", marketing: "#f3cfae" }[role];
  const id = `d-${role}`;
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} aria-hidden className={busy ? "desk-busy" : undefined}>
      <defs>
        <linearGradient id={`${id}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b4a66" /><stop offset="1" stopColor="#222c40" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor={c} stopOpacity={busy ? 0.45 : 0.12} /><stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* zemin gölgesi + ekran ışığı */}
      <ellipse cx="100" cy="160" rx="84" ry="8" fill="rgba(0,0,0,.35)" />
      <ellipse cx="100" cy="62" rx="70" ry="48" fill={`url(#${id}-glow)`} />
      {/* sandalye sırtlığı */}
      <rect x="70" y="92" width="60" height="44" rx="12" fill="#1b2335" stroke="rgba(148,180,255,.15)" />
      {/* gövde (gömlek) */}
      <path d="M72 128 Q72 100 100 98 Q128 100 128 128 Z" fill={c} opacity=".92" />
      <path d="M92 99 L100 110 L108 99" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="2" />
      {/* baş */}
      <circle cx="100" cy="80" r="15" fill={skin} />
      <path d={role === "marketing" ? "M84 82 Q82 60 100 62 Q120 60 117 84 Q118 70 108 68 Q96 74 86 70 Z" : "M85 78 Q86 62 100 63 Q115 62 115 78 Q110 69 100 70 Q90 69 85 78 Z"} fill={hair} />
      {role === "manager" && <rect x="96" y="104" width="8" height="14" rx="2" fill="#1e293b" />}
      {/* kollar → klavye */}
      <g className={typing ? "arm-l" : undefined}><path d="M76 116 Q70 126 86 132" stroke={c} strokeWidth="9" fill="none" strokeLinecap="round" /></g>
      <g className={typing ? "arm-r" : undefined}><path d="M124 116 Q130 126 114 132" stroke={c} strokeWidth="9" fill="none" strokeLinecap="round" /></g>
      {/* masa */}
      <rect x="20" y="132" width="160" height="12" rx="3" fill={`url(#${id}-desk)`} />
      <rect x="30" y="144" width="8" height="16" fill="#1a2234" /><rect x="162" y="144" width="8" height="16" fill="#1a2234" />
      {/* ajanın önündeki dizüstü (kapağın arkası bize dönük; ekran ışığı yüze vurur) */}
      {busy && <ellipse cx="100" cy="86" rx="20" ry="12" fill={c} opacity=".18" />}
      <path d="M74 132 L80 106 L120 106 L126 132 Z" fill="#c9d2e3" stroke="rgba(0,0,0,.25)" />
      <path d="M80 106 L120 106 L119 110 L81 110 Z" fill="rgba(255,255,255,.35)" />
      <circle cx="100" cy="119" r="4" fill={busy ? c : "#9aa6bd"} opacity={busy ? 0.95 : 0.6} />
      {/* yan monitör: çalışırken satırlar akar */}
      <g transform="translate(140 96)">
        <rect x="0" y="0" width="44" height="32" rx="3" fill="#0b1220" stroke="rgba(148,180,255,.4)" />
        <rect x="3" y="3" width="38" height="26" rx="2" fill={busy ? "#0d2233" : "#0a1220"} />
        <g className={typing ? "screen-scroll" : undefined} clipPath={`url(#${id}-clip)`}>
          {[6, 11, 16, 21, 26, 31, 36].map((y, i) => (
            <rect key={y} x={6 + (i % 3) * 2} y={y} width={[22, 16, 28, 12, 24, 18, 20][i]} height="2.2" rx="1" fill={busy ? c : "rgba(148,180,255,.25)"} opacity={busy ? 0.85 : 0.6} />
          ))}
        </g>
        <clipPath id={`${id}-clip`}><rect x="3" y="3" width="38" height="26" rx="2" /></clipPath>
        <rect x="18" y="32" width="8" height="4" fill="#2a3550" />
      </g>
      {/* masa üstü küçük eşya: kahve kupası */}
      <g transform="translate(36 120)"><rect x="0" y="0" width="10" height="12" rx="2" fill="#e5e7eb" /><path d="M10 3 Q15 6 10 9" stroke="#e5e7eb" strokeWidth="2" fill="none" />{busy && <path className="steam" d="M3 -2 Q1 -7 4 -11 M7 -2 Q5 -8 8 -12" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" fill="none" />}</g>
      {/* durum ışığı */}
      <circle cx="100" cy="14" r="4" fill={status === "idle" ? "rgba(148,180,255,.3)" : status === "done" ? "#7ee2b8" : c} className={busy ? "status-pulse" : undefined} />
    </svg>
  );
}

// ---- Ajan becerileri paneli ----
type Skill = { id: string; name: string; description: string; content: string; teamRoles?: string[] };
function AgentPanel({ role, onClose }: { role: TeamRole; onClose: () => void }) {
  const meta = TEAM_META[role];
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", content: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const d = await fetch("/api/skills").then((r) => r.json()); setSkills(Array.isArray(d.skills) ? d.skills : []); }
    catch { setSkills([]); }
  }
  useEffect(() => { load(); }, []);
  const mine = (skills ?? []).filter((s) => (s.teamRoles ?? []).includes(role));
  const others = (skills ?? []).filter((s) => !(s.teamRoles ?? []).includes(role));

  async function setRoles(s: Skill, roles: string[]) {
    setBusy(true);
    await fetch(`/api/skills/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamRoles: roles }) }).catch(() => {});
    await load(); setBusy(false);
  }
  async function create() {
    if (!form.name.trim() || !form.content.trim()) return;
    setBusy(true);
    await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, agentKeys: [], teamRoles: [role] }) }).catch(() => {});
    setForm({ name: "", description: "", content: "" }); setAdding(false);
    await load(); setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" style={{ background: "rgba(3,6,14,.65)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border-strong)" }}
        role="dialog" aria-label={`${meta.name} becerileri`}
      >
        <div className="flex items-start gap-3 border-b p-4" style={{ borderColor: "var(--border)" }}>
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: meta.color }} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold">{meta.name} <span className="font-normal" style={{ color: "var(--text-muted)" }}>· {meta.title}</span></div>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{meta.desc}</p>
          </div>
          <button onClick={onClose} aria-label="Kapat" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--text-muted)" }}>
            <IconClose width={18} height={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 text-[12px] font-semibold" style={{ color: "var(--text-muted)", letterSpacing: ".05em" }}>YÜKLÜ BECERİLER ({mine.length})</div>
          {skills === null ? <div className="text-[14px]" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div> : (
            <ul className="flex flex-col gap-2">
              {mine.map((s) => (
                <li key={s.id} className="rounded-xl p-3" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="min-w-0 flex-1 text-left">
                      <div className="text-[14px] font-medium">{s.name}</div>
                      {s.description && <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{s.description}</div>}
                    </button>
                    <button disabled={busy} onClick={() => setRoles(s, (s.teamRoles ?? []).filter((x) => x !== role))} className="h-8 shrink-0 rounded-lg px-2 text-[12px]" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>Çıkar</button>
                  </div>
                  {openId === s.id && <pre className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: "var(--text-muted)", fontFamily: "inherit" }}>{s.content}</pre>}
                </li>
              ))}
              {mine.length === 0 && <li className="text-[13px]" style={{ color: "var(--text-muted)" }}>Bu ajana yüklü beceri yok.</li>}
            </ul>
          )}

          {adding ? (
            <div className="mt-4 flex flex-col gap-2 rounded-xl p-3" style={{ border: "1px solid var(--border-strong)" }}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Beceri adı" className="h-11 rounded-lg px-3 text-[14px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Kısa açıklama (isteğe bağlı)" className="h-11 rounded-lg px-3 text-[14px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
              <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Talimatlar: bu ajan bu konuda nasıl çalışsın? Kurallar, kontrol listesi, örnekler…" rows={6} className="rounded-lg p-3 text-[14px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
              <div className="flex gap-2">
                <button disabled={busy || !form.name.trim() || !form.content.trim()} onClick={create} className="h-11 flex-1 rounded-lg text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#04141f" }}>Kaydet ve yükle</button>
                <button onClick={() => setAdding(false)} className="h-11 rounded-lg px-4 text-[14px]" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>Vazgeç</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium" style={{ border: "1px dashed var(--border-strong)", color: "var(--text)" }}>
              <IconPlus width={18} height={18} /> Yeni beceri ekle
            </button>
          )}

          {others.length > 0 && (
            <>
              <div className="mb-2 mt-6 text-[12px] font-semibold" style={{ color: "var(--text-muted)", letterSpacing: ".05em" }}>DİĞER BECERİLERDEN YÜKLE</div>
              <ul className="flex flex-col gap-2">
                {others.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-xl p-3" style={{ border: "1px solid var(--border)" }}>
                    <div className="min-w-0 flex-1 truncate text-[14px]">{s.name}</div>
                    <button disabled={busy} onClick={() => setRoles(s, [...(s.teamRoles ?? []), role])} className="h-8 shrink-0 rounded-lg px-3 text-[12px] font-medium" style={{ color: "var(--accent)", border: "1px solid var(--border-strong)" }}>Yükle</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
