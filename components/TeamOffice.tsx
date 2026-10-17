"use client";

// Proje ofisi: 4 çalışma masası (Araştırma, Müdür, Kod, Satış & Pazarlama).
// Her ajan isimli bir insan (proje başına sabit, 2 kadın + 2 erkek, Türkçe isim);
// dizüstünün başında oturur. Durumunu sohbet akışından okur ("nova:stream"):
// çalışıyor → elleri klavyede, başı hafifçe sallanır, yan ekranda satırlar akar;
// konuşuyor → ağız hareket eder; herkes ara ara göz kırpar. Masa altında isim,
// durum ve o an kullanılan model seviyesi görünür. Masaya tıklayınca becerileri açılır.
import { useEffect, useState } from "react";
import { TEAM_META, TEAM_ROLES, teamCast, type Member, type TeamRole } from "@/lib/team/roles";
import { IconClose, IconPlus } from "./UniverseIcons";
import OfficeRoom from "./OfficeRoom";
import CameraView, { type CamScene } from "./CameraView";

type Status = "idle" | "thinking" | "working" | "reviewing" | "done" | "speaking";
const STATUS_TR: Record<Status, string> = {
  idle: "Boşta", thinking: "Planlıyor", working: "Çalışıyor", reviewing: "Denetliyor", done: "Teslim etti", speaking: "Konuşuyor",
};

// Akış metninden rol durumlarını ve kullanılan model seviyesini çıkar
function parseStatuses(text: string, running: boolean) {
  const st: Record<TeamRole, Status> = { manager: running ? "thinking" : "idle", research: "idle", coder: "idle", marketing: "idle" };
  const tier: Partial<Record<TeamRole, string>> = {};
  const nameToRole = new Map<string, TeamRole>(TEAM_ROLES.map((r) => [TEAM_META[r].name, r]));
  let lastEvent: "work" | "done" | null = null;
  for (const line of text.split("\n")) {
    const w = line.match(/^👥 (.+?) çalışıyor(?: \[([A-Za-z]+)\])?/);
    const d = line.match(/^👥 (.+?) teslim etti/);
    const m = w || d;
    if (!m) continue;
    const role = nameToRole.get(m[1]);
    if (!role) continue;
    st[role] = w ? "working" : "done";
    if (w && w[2]) tier[role] = w[2];
    lastEvent = w ? "work" : "done";
  }
  if (!running) {
    for (const r of TEAM_ROLES) if (st[r] === "working") st[r] = "done";
  } else {
    st.manager = lastEvent === "work" ? "thinking" : lastEvent === "done" ? "reviewing" : "thinking";
  }
  return { st, tier };
}

// Proje kamera bilgileri tarayıcıda saklanır → sekme geçişi anında, ara görüntü yok
type CamData = { status: string; scene?: CamScene; error?: string; clipsBusy?: boolean; fallback?: { scope: string; scene: CamScene } | null };
const camCache = new Map<string, CamData>();
type CamSize = "kucuk" | "orta" | "buyuk";
const CAM_SIZES: Record<CamSize, { h: number; label: string }> = { kucuk: { h: 140, label: "Küçük" }, orta: { h: 220, label: "Orta" }, buyuk: { h: 380, label: "Büyük" } };
const IDLE: Record<TeamRole, string> = { manager: "idle", research: "idle", coder: "idle", marketing: "idle" };
export function prefetchOffices(ids: string[]) {
  for (const id of ids) {
    if (camCache.get(id)?.status === "ready") continue;
    fetch(`/api/office?scope=${encodeURIComponent(id)}`).then((r) => r.json()).then((d: CamData) => {
      camCache.set(id, d);
      const sc = d.scene ?? d.fallback?.scene;
      if (sc) { const im = new Image(); im.src = `/api/office?scope=${encodeURIComponent(d.scene ? id : d.fallback!.scope)}&img=1&v=${sc.createdAt}`; }
    }).catch(() => {});
  }
}

export default function TeamOffice({ convId, title = "", compact = false }: { convId: string; title?: string; compact?: boolean }) {
  const [running, setRunning] = useState(false);
  const [camSize, setCamSize] = useState<CamSize>("orta");
  useEffect(() => { try { const v = localStorage.getItem("nova:camSize"); if (v && v in CAM_SIZES) setCamSize(v as CamSize); } catch { /* yoksay */ } }, []);
  const cycleCamSize = () => setCamSize((s) => {
    const order: CamSize[] = ["kucuk", "orta", "buyuk"];
    const next = order[(order.indexOf(s) + 1) % order.length];
    try { localStorage.setItem("nova:camSize", next); } catch { /* yoksay */ }
    return next;
  });
  // gerçekçi kamera karesi; hazır değilse başka projenin sahnesi (etiketsiz), o da yoksa çizim oda
  const [cam, setCam] = useState<CamData | null>(() => camCache.get(convId) ?? null);
  useEffect(() => {
    let stop = false, timer = 0;
    setCam(camCache.get(convId) ?? null);
    const poll = (n: number) => {
      fetch(`/api/office?scope=${encodeURIComponent(convId)}`).then((r) => r.json()).then((d: CamData) => {
        if (stop) return;
        camCache.set(convId, d);
        setCam(d);
        if ((d.status !== "ready" || d.clipsBusy) && n < 60) timer = window.setTimeout(() => poll(n + 1), 10000); // kare/videolar hazırlanırken tazele
      }).catch(() => {
        if (!stop && n < 30) timer = window.setTimeout(() => poll(n + 1), 3000); // ağ hatası: kısa aralıkla yeniden dene
      });
    };
    poll(0);
    return () => { stop = true; clearTimeout(timer); };
  }, [convId]);
  const [text, setText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState<TeamRole | null>(null);
  const cast = teamCast(convId);

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

  const { st, tier } = parseStatuses(text, running);
  if (speaking && !running) st.manager = "speaking";

  // kamera şeridi yüksekliği (küçük/orta/büyük) — sohbete yer kalsın; seçim tarayıcıda saklanır
  const H = CAM_SIZES[camSize].h;
  const camBox = { height: compact ? Math.min(H, 180) : H } as const;
  const sizeBtn = (
    <button
      onClick={cycleCamSize}
      className="absolute bottom-2 right-2 z-[5] rounded-md px-2 py-1 text-[11px]"
      style={{ background: "rgba(0,0,0,.55)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,.2)" }}
      title="Kamera boyutu: küçük / orta / büyük"
      aria-label={`Kamera boyutu: ${CAM_SIZES[camSize].label}. Değiştir`}
    >
      ⤢ {CAM_SIZES[camSize].label}
    </button>
  );
  if (cam?.status === "ready" && cam.scene) {
    return (
      <div className="relative w-full" style={camBox}>
        <CameraView convId={convId} title={title} scene={cam.scene} cast={cast} status={st} statusTr={STATUS_TR} tier={tier} onOpen={setOpen} />
        {sizeBtn}
        {open && <AgentPanel role={open} person={cast[open].name} onClose={() => setOpen(null)} />}
      </div>
    );
  }
  // kendi ofisi hazırlanıyor: başka projenin gerçekçi ofisi, etiketsiz
  if (cam?.fallback) {
    return (
      <div className="relative w-full" style={camBox}>
        <CameraView convId={cam.fallback.scope} title={title} scene={cam.fallback.scene} cast={cast} status={IDLE} statusTr={STATUS_TR} tier={{}} onOpen={setOpen} labels={false} />
        {sizeBtn}
        <div className="absolute bottom-3 left-1/2 z-[4] -translate-x-1/2 rounded-full px-3 py-1.5 text-[12px]" style={{ background: "rgba(0,0,0,.6)", color: "#f1f5f9" }} title={cam.error || ""}>
          {cam.status === "pending" ? "📷 Ekibinizin ofisi hazırlanıyor… (1–3 dk)" : "📷 Ofis görüntüsü için görsel kredisi gerekli"}
        </div>
      </div>
    );
  }
  // ilk yükleme: çizim oda yerine koyu kamera ekranı
  if (!cam) {
    return (
      <div className="relative flex w-full items-center justify-center bg-black" style={camBox}>
        <span className="text-[12px]" style={{ color: "#9ca3af", fontFamily: "Consolas, monospace" }}>● KAM-01 · bağlanıyor…</span>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden">
      <OfficeRoom />
      {cam && cam.status !== "ready" && (
        <div className="absolute left-2 top-2 z-[2] rounded-md px-2 py-1 text-[11px]" style={{ background: "rgba(0,0,0,.5)", color: "#e5e7eb" }} title={cam.error || ""}>
          {cam.status === "pending" ? "📷 Gerçekçi kamera görüntüsü hazırlanıyor…" : "📷 Gerçekçi görüntü için görsel kredisi gerekli"}
        </div>
      )}
      <div
        className={`relative z-[1] flex w-full items-end justify-center gap-2 overflow-x-auto px-3 sm:gap-6 ${compact ? "pb-2 pt-6" : "pb-3 pt-16"}`}
        role="list" aria-label="Proje ekibi"
      >
        {(["research", "manager", "coder", "marketing"] as TeamRole[]).map((r) => (
          <button
            key={r} role="listitem" onClick={() => setOpen(r)}
            className="group flex shrink-0 flex-col items-center gap-1 rounded-2xl p-1 outline-none transition-transform duration-200 hover:-translate-y-1 focus-visible:-translate-y-1"
            aria-label={`${cast[r].name}, ${TEAM_META[r].name} — ${STATUS_TR[st[r]]}. Becerileri aç`}
          >
            <Desk role={r} member={cast[r]} status={st[r]} size={compact ? 122 : r === "manager" ? 180 : 156} />
            <div className="flex flex-col items-center leading-tight">
              <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>{cast[r].name}</span>
              <span className="text-[11px]" style={{ color: TEAM_META[r].color }}>{TEAM_META[r].name}</span>
            </div>
            <div className="flex items-center gap-1">
              <span
                className="rounded-full px-2 py-[2px] text-[11px] font-medium"
                style={{
                  color: st[r] === "idle" ? "var(--text-muted)" : "#06121d",
                  background: st[r] === "idle" ? "rgba(148,180,255,.08)" : st[r] === "done" ? "#7ee2b8" : TEAM_META[r].color,
                }}
              >
                {STATUS_TR[st[r]]}
              </span>
              {st[r] === "working" && tier[r] && (
                <span className="rounded-full px-2 py-[2px] text-[11px]" style={{ color: "var(--text)", border: "1px solid var(--border-strong)" }} title="Müdürün bu iş için seçtiği model">
                  {tier[r]}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {open && <AgentPanel role={open} person={cast[open].name} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---- İnsan karakter + masa (SVG) ----
const SKIN = ["#f3d2b5", "#f1c8a0", "#e8b98f", "#d9a378", "#c98e62", "#a8714a"];
// koyu lacivert zeminden ayrışan tonlar (çok koyu siyah/gri saç zeminde kaybolup kel gibi görünüyordu)
const HAIR = ["#4a2c1a", "#5e3420", "#6b3f22", "#3f2a1e", "#7a4a24", "#553222"];
const LIPS = ["#c46a6a", "#b85a6a", "#d07a7a", "#a85a5a"];

function Desk({ role, member, status, size }: { role: TeamRole; member: Member; status: Status; size: number }) {
  const c = TEAM_META[role].color;
  const L = member.look;
  const female = member.gender === "k";
  const skin = SKIN[L % SKIN.length];
  const hair = HAIR[(L >>> 3) % HAIR.length];
  const lips = LIPS[(L >>> 5) % LIPS.length];
  const hairStyle = female ? (L >>> 7) % 3 : (L >>> 7) % 3; // k: 0 uzun, 1 topuz, 2 kısa küt | e: 0 kısa, 1 yana taralı, 2 kıvırcık
  const beard = !female && (L >>> 9) % 3 === 0;
  const glasses = (L >>> 11) % 3 === 0;
  const busy = status === "working" || status === "thinking" || status === "reviewing" || status === "speaking";
  const typing = status === "working";
  const talking = status === "speaking";
  const id = `d-${role}`;
  const blinkDelay = `${(L % 40) / 10}s`;

  // Kıyafet: role göre
  const outfit = {
    manager: { main: "#1e293b", inner: female ? "#f8fafc" : "#e2e8f0", accent: c, tie: !female },
    research: { main: "#3f6b5a", inner: "#e7f5ee", accent: c, tie: false },
    coder: { main: "#1f2937", inner: "#111827", accent: c, tie: false },
    marketing: { main: female ? "#be4b84" : "#7c3a5e", inner: "#fdf2f8", accent: c, tie: false },
  }[role];

  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} aria-hidden>
      <defs>
        <linearGradient id={`${id}-desk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a63b0" /><stop offset="1" stopColor="#363d82" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor={c} stopOpacity={busy ? 0.42 : 0.1} /><stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-face`} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" /><stop offset="1" stopColor="#000000" stopOpacity="0.12" />
        </radialGradient>
        <clipPath id={`${id}-clip`}><rect x="3" y="3" width="38" height="26" rx="2" /></clipPath>
      </defs>

      <ellipse cx="100" cy="160" rx="84" ry="8" fill="rgba(8,10,40,.35)" />
      <ellipse cx="100" cy="64" rx="72" ry="50" fill={`url(#${id}-glow)`} />

      {/* sandalye */}
      <rect x="64" y="84" width="72" height="54" rx="14" fill="#2c3478" stroke="rgba(200,210,255,.25)" />

      {/* arka saç (uzun saçta omuzlara iner) */}
      {female && hairStyle === 0 && <path d="M80 70 Q78 104 86 112 L114 112 Q122 104 120 70 Q118 52 100 52 Q82 52 80 70 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} />}

      {/* gövde + kıyafet */}
      <path d="M68 136 Q68 104 86 100 L114 100 Q132 104 132 136 Z" fill={outfit.main} />
      <path d="M92 100 L100 116 L108 100 Z" fill={outfit.inner} />
      {outfit.tie && <path d="M98 104 L102 104 L103.5 120 L100 124 L96.5 120 Z" fill={outfit.accent} />}
      {role === "coder" && <path d="M84 101 Q100 112 116 101" stroke="#374151" strokeWidth="3" fill="none" />}
      {/* yaka kartı (rol rengi) */}
      <rect x="111" y="112" width="8" height="10" rx="1.5" fill={outfit.accent} opacity=".9" />

      {/* boyun */}
      <rect x="94" y="86" width="12" height="16" rx="4" fill={skin} />
      <path d="M94 96 Q100 100 106 96" stroke="rgba(0,0,0,.12)" strokeWidth="2" fill="none" />

      <g className={typing ? "head-nod" : undefined} style={{ transformOrigin: "100px 92px" }}>
        {/* kulaklar */}
        {!(female && hairStyle !== 2) && <><ellipse cx="85" cy="74" rx="3" ry="4.5" fill={skin} /><ellipse cx="115" cy="74" rx="3" ry="4.5" fill={skin} /></>}
        {/* yüz */}
        <ellipse cx="100" cy="72" rx="15" ry="18" fill={skin} />
        <ellipse cx="100" cy="72" rx="15" ry="18" fill={`url(#${id}-face)`} />
        {/* sakal */}
        {beard && <path d="M86 74 Q87 90 100 92 Q113 90 114 74 Q110 84 100 85 Q90 84 86 74 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} opacity=".85" />}
        {/* kaşlar */}
        <path d="M90 66 Q94 64 97 66" stroke={hair} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M103 66 Q106 64 110 66" stroke={hair} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {/* gözler (ara ara kırpar) */}
        <g className="blink" style={{ animationDelay: blinkDelay, transformOrigin: "100px 71px" }}>
          <ellipse cx="94" cy="71" rx="2" ry="2.3" fill="#1b1410" />
          <ellipse cx="106" cy="71" rx="2" ry="2.3" fill="#1b1410" />
          <circle cx="94.7" cy="70.2" r=".6" fill="#fff" /><circle cx="106.7" cy="70.2" r=".6" fill="#fff" />
          {female && <><path d="M91.5 69.4 L90.3 68.6" stroke="#1b1410" strokeWidth=".8" /><path d="M108.5 69.4 L109.7 68.6" stroke="#1b1410" strokeWidth=".8" /></>}
        </g>
        {/* gözlük */}
        {glasses && <g stroke="#2b2b2b" strokeWidth="1.2" fill="rgba(200,230,255,.12)"><circle cx="94" cy="71" r="4.6" /><circle cx="106" cy="71" r="4.6" /><path d="M98.6 71 L101.4 71" /></g>}
        {/* burun */}
        <path d="M100 73 Q98.6 78 100.8 79" stroke="rgba(0,0,0,.28)" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {/* yanak */}
        {female && <><ellipse cx="90" cy="78" rx="3" ry="1.8" fill="#e88" opacity=".22" /><ellipse cx="110" cy="78" rx="3" ry="1.8" fill="#e88" opacity=".22" /></>}
        {/* ağız (konuşurken açılıp kapanır) */}
        {talking
          ? <ellipse className="talk" cx="100" cy="83.5" rx="3.2" ry="1.8" fill="#5a2a2a" style={{ transformOrigin: "100px 83.5px" }} />
          : <path d="M96 83 Q100 86 104 83" stroke={female ? lips : "rgba(80,40,30,.7)"} strokeWidth={female ? 1.8 : 1.3} fill="none" strokeLinecap="round" />}
        {/* ön saç */}
        {female && hairStyle === 0 && <path d="M84 74 Q82 51 100 50 Q118 51 116 74 Q112 60 103 59 Q93 59 88 66 Q85 70 84 74 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} />}
        {female && hairStyle === 1 && <><circle cx="100" cy="50" r="7" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} /><path d="M85 70 Q84 54 100 54 Q116 54 115 70 Q111 59 100 59 Q89 59 85 70 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} /></>}
        {female && hairStyle === 2 && <path d="M81 88 Q78 50 100 49 Q122 50 119 88 L113 88 Q115 68 107 63 Q100 61 93 63 Q85 68 87 88 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} />}
        {!female && hairStyle === 0 && <path d="M84 74 Q82 50 100 49 Q118 50 116 74 L114 74 Q113 62 100 61 Q87 62 86 74 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} />}
        {!female && hairStyle === 1 && <path d="M84 74 Q81 49 103 48 Q120 50 116 72 L114 72 Q112 61 104 59 Q95 58 89 64 Q86 68 86 74 Z" fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8} />}
        {!female && hairStyle === 2 && <g fill={hair} stroke="rgba(255,255,255,.22)" strokeWidth={0.8}>{[86, 91, 96, 101, 106, 111, 114].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 56 : 59} r="5" />)}</g>}
      </g>

      {/* kollar (klavyeye uzanır) */}
      <g className={typing ? "arm-l" : undefined}><path d="M74 118 Q70 130 86 133" stroke={outfit.main} strokeWidth="10" fill="none" strokeLinecap="round" /><circle cx="88" cy="133" r="4" fill={skin} /></g>
      <g className={typing ? "arm-r" : undefined}><path d="M126 118 Q130 130 114 133" stroke={outfit.main} strokeWidth="10" fill="none" strokeLinecap="round" /><circle cx="112" cy="133" r="4" fill={skin} /></g>

      {/* masa */}
      <rect x="20" y="132" width="160" height="12" rx="3" fill={`url(#${id}-desk)`} />
      <rect x="30" y="144" width="8" height="16" fill="#2a3170" /><rect x="162" y="144" width="8" height="16" fill="#2a3170" />

      {/* önündeki dizüstü (kapağın arkası bize dönük; ekran ışığı yüze vurur) */}
      {busy && <ellipse cx="100" cy="80" rx="18" ry="12" fill={c} opacity=".14" />}
      <path d="M76 132 L81 108 L119 108 L124 132 Z" fill="#c9d2e3" stroke="rgba(0,0,0,.25)" />
      <path d="M81 108 L119 108 L118.4 111 L81.6 111 Z" fill="rgba(255,255,255,.35)" />
      <circle cx="100" cy="120" r="3.6" fill={busy ? c : "#9aa6bd"} opacity={busy ? 0.95 : 0.6} />

      {/* yan monitör */}
      <g transform="translate(140 96)">
        <rect x="0" y="0" width="44" height="32" rx="3" fill="#0b1220" stroke="rgba(148,180,255,.4)" />
        <rect x="3" y="3" width="38" height="26" rx="2" fill={busy ? "#0d2233" : "#0a1220"} />
        <g className={typing ? "screen-scroll" : undefined} clipPath={`url(#${id}-clip)`}>
          {[6, 11, 16, 21, 26, 31, 36].map((y, i) => (
            <rect key={y} x={6 + (i % 3) * 2} y={y} width={[22, 16, 28, 12, 24, 18, 20][i]} height="2.2" rx="1" fill={busy ? c : "rgba(148,180,255,.25)"} opacity={busy ? 0.85 : 0.6} />
          ))}
        </g>
        <rect x="18" y="32" width="8" height="4" fill="#2a3550" />
      </g>

      {/* kupa */}
      <g transform="translate(34 120)"><rect x="0" y="0" width="10" height="12" rx="2" fill="#e5e7eb" /><path d="M10 3 Q15 6 10 9" stroke="#e5e7eb" strokeWidth="2" fill="none" />{busy && <path className="steam" d="M3 -2 Q1 -7 4 -11 M7 -2 Q5 -8 8 -12" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" fill="none" />}</g>

      {/* durum ışığı */}
      <circle cx="100" cy="12" r="4" fill={status === "idle" ? "rgba(148,180,255,.3)" : status === "done" ? "#7ee2b8" : c} className={busy ? "status-pulse" : undefined} />
    </svg>
  );
}

// ---- Ajan becerileri paneli ----
type Skill = { id: string; name: string; description: string; content: string; teamRoles?: string[] };
function AgentPanel({ role, person, onClose }: { role: TeamRole; person: string; onClose: () => void }) {
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
        role="dialog" aria-label={`${person} (${meta.name}) becerileri`}
      >
        <div className="flex items-start gap-3 border-b p-4" style={{ borderColor: "var(--border)" }}>
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: meta.color }} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold">{person} <span className="font-normal" style={{ color: "var(--text-muted)" }}>· {meta.title}</span></div>
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
