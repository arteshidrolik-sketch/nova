"use client";

import { AGENT_META, AGENT_KEYS, type AgentActivity } from "@/lib/agents/meta";

export type VoiceState = "idle" | "listening" | "speaking";

const CX = 500;
const CY = 330;

const POS: Record<string, { x: number; y: number }> = {
  research: { x: 205, y: 168 },
  general: { x: 512, y: 122 },
  codeReviewer: { x: 826, y: 172 },
  releaseStore: { x: 842, y: 368 },
  projectOps: { x: 548, y: 556 },
  developer: { x: 158, y: 488 },
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STAR_COLORS = ["#ffffff", "#ffffff", "#eaf2ff", "#bfdbfe", "#fde68a", "#fecaca"];
const rand = mulberry32(20240620);
const STARS = Array.from({ length: 70 }, () => {
  const bright = rand() > 0.93;
  return {
    x: +(rand() * 1000).toFixed(1),
    y: +(rand() * 680).toFixed(1),
    r: +(0.4 + rand() * 1.5).toFixed(2),
    dur: +(2.5 + rand() * 4).toFixed(2),
    delay: +(rand() * 5).toFixed(2),
    color: STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)],
    bright,
  };
});

function curve(x: number, y: number): string {
  const mx = (CX + x) / 2;
  const my = (CY + y) / 2;
  const dx = x - CX;
  const dy = y - CY;
  const len = Math.hypot(dx, dy) || 1;
  const k = 55;
  const cpx = mx + (-dy / len) * k;
  const cpy = my + (dx / len) * k;
  return `M ${CX} ${CY} Q ${cpx} ${cpy} ${x} ${y}`;
}

function Wave({ color, active }: { color: string; active: boolean }) {
  return (
    <div className="flex h-5 items-end gap-[3px]">
      {Array.from({ length: 16 }).map((_, i) => (
        <i
          key={i}
          style={{
            display: "inline-block",
            width: 3,
            borderRadius: 2,
            background: color,
            height: active ? undefined : 4,
            opacity: active ? 1 : 0.5,
            animation: active ? `bar 0.9s ${i * 0.05}s infinite ease-in-out` : "none",
          }}
        />
      ))}
    </div>
  );
}

export default function AgentGraph({
  active,
  voice = "idle",
  onMic,
  wakeOn = false,
  onToggleWake,
}: {
  active: AgentActivity;
  voice?: VoiceState;
  onMic?: () => void;
  wakeOn?: boolean;
  onToggleWake?: () => void;
}) {
  const orchActive = active === "orchestrator";
  const speaking = voice === "speaking";
  const listening = voice === "listening";

  function enterFullscreen() {
    if (typeof document === "undefined" || document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function toggleFullscreen() {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // Boşluğa (uzaya) tıklayınca tam ekran — butonlar hariç
  function onBgClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    enterFullscreen();
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: "#02040a", cursor: "pointer" }}
      onClick={onBgClick}
      title="Tam ekran için ekrana tıkla"
    >
      {/* NASA foto arka plan (yavaş canlı zoom) */}
      <div className="nova-space-bg absolute inset-0" style={{ zIndex: 0 }} />
      {/* okunabilirlik için karartma */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 0,
          background:
            "radial-gradient(120% 90% at 50% 45%, rgba(2,4,10,0.08) 0%, rgba(2,4,10,0.48) 66%, rgba(2,4,10,0.82) 100%)",
        }}
      />
      <svg
        viewBox="0 0 1000 680"
        preserveAspectRatio="xMidYMid slice"
        className="relative h-full w-full"
        style={{ zIndex: 10, pointerEvents: "none" }}
      >
        <defs>
          <radialGradient id="bg" cx="50%" cy="44%" r="80%">
            <stop offset="0%" stopColor="#0a1226" />
            <stop offset="55%" stopColor="#060a16" />
            <stop offset="100%" stopColor="#02040a" />
          </radialGradient>
          {/* nebula gaz bulutları */}
          <radialGradient id="nebA" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebB" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebC" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#be185d" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#be185d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebD" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0e7490" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#0e7490" stopOpacity="0" />
          </radialGradient>
          <filter id="nebBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="36" />
          </filter>
          <filter id="starGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="orbGrad" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="#e6fcff" />
            <stop offset="38%" stopColor="#22d3ee" />
            <stop offset="72%" stopColor="#0b6f93" />
            <stop offset="100%" stopColor="#063246" />
          </radialGradient>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" />
            <stop offset="55%" stopColor="#22d3ee" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="50%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          {/* gezegen gövde gradyanları (ışık sol-üstten) */}
          <radialGradient id="saturnBody" cx="36%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f6e8b4" />
            <stop offset="50%" stopColor="#cda94f" />
            <stop offset="100%" stopColor="#6e4d18" />
          </radialGradient>
          <radialGradient id="venusBody" cx="36%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#fbf1d6" />
            <stop offset="50%" stopColor="#e6bd6c" />
            <stop offset="100%" stopColor="#8a6526" />
          </radialGradient>
          <radialGradient id="marsBody" cx="36%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f0996b" />
            <stop offset="50%" stopColor="#b8472d" />
            <stop offset="100%" stopColor="#511910" />
          </radialGradient>
          {/* küre kenar kararması (limb darkening → 3B) */}
          <radialGradient id="sphereShade" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="62%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
          </radialGradient>
          <linearGradient id="shoot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <clipPath id="orbClip">
            <circle cx={CX} cy={CY} r="46" />
          </clipPath>
          <clipPath id="satFront">
            <rect x="735" y="525" width="230" height="130" />
          </clipPath>
          <filter id="plasma">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="7" result="n">
              <animate attributeName="baseFrequency" dur="20s" values="0.018;0.03;0.018" repeatCount="indefinite" />
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0.75  0 0 0 0 0.95  0 0 0 0.9 0" />
          </filter>
          {/* gezegen yüzey dokuları (bulut bantları) */}
          <filter id="texVenus">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.13" numOctaves="2" seed="3" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.43  0 0 0 0 0.18  0 0 0 0.5 0" />
          </filter>
          <filter id="texSaturn">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.16" numOctaves="2" seed="9" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.31  0 0 0 0 0.12  0 0 0 0.6 0" />
          </filter>
          <filter id="texMars">
            <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="3" seed="14" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.32  0 0 0 0 0.11  0 0 0 0 0.06  0 0 0 0.6 0" />
          </filter>
          <clipPath id="clipVenus"><circle cx="150" cy="150" r="32" /></clipPath>
          <clipPath id="clipSaturn"><circle cx="845" cy="525" r="40" /></clipPath>
          <clipPath id="clipMars"><circle cx="118" cy="560" r="17" /></clipPath>
        </defs>

        {/* yıldızlar (foto üstünde parıltı + hareket) */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; -16 10; 0 0" dur="45s" repeatCount="indefinite" />
          {STARS.map((s, i) => (
            <circle
              key={i}
              className="star"
              cx={s.x}
              cy={s.y}
              r={s.bright ? s.r + 0.9 : s.r}
              fill={s.color}
              filter={s.bright ? "url(#starGlow)" : undefined}
              style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
            />
          ))}
        </g>

        {/* ikinci kayan yıldız (farklı yön/zaman) */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="1120 110; 180 520; 180 520" keyTimes="0; 0.14; 1" dur="13s" begin="5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0; 1; 0; 0" keyTimes="0; 0.06; 0.15; 1" dur="13s" begin="5s" repeatCount="indefinite" />
          <line x1="62" y1="-30" x2="0" y2="0" stroke="url(#shoot)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="0" cy="0" r="2.2" fill="#ffffff" />
        </g>

        {/* kayan yıldız */}
        <g>
          <animateTransform attributeName="transform" type="translate" values="-220 -120; 760 400; 760 400" keyTimes="0; 0.12; 1" dur="9s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0; 1; 0; 0" keyTimes="0; 0.05; 0.13; 1" dur="9s" repeatCount="indefinite" />
          <line x1="-58" y1="-32" x2="0" y2="0" stroke="url(#shoot)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="2.6" fill="#ffffff" />
        </g>

        {/* bağlantı hatları */}
        {AGENT_KEYS.map((key) => {
          const p = POS[key];
          const on = active === key;
          const color = AGENT_META[key].color;
          return (
            <path
              key={`e-${key}`}
              d={curve(p.x, p.y)}
              fill="none"
              stroke={on ? color : "#22d3ee"}
              strokeOpacity={on ? 0.95 : 0.28}
              strokeWidth={on ? 3 : 1.4}
              filter={on ? "url(#glow)" : undefined}
              strokeLinecap="round"
              strokeDasharray={on ? "6 8" : undefined}
            >
              {on && <animate attributeName="stroke-dashoffset" from="40" to="0" dur="0.6s" repeatCount="indefinite" />}
            </path>
          );
        })}

        {/* merkez çekirdek */}
        <g className="orb-halo">
          <circle cx={CX} cy={CY} r="82" fill="url(#halo)" />
        </g>
        <g className="orb-core">
          <g clipPath="url(#orbClip)">
            <rect x={CX - 46} y={CY - 46} width="92" height="92" filter="url(#plasma)" />
            <circle cx={CX} cy={CY} r="46" fill="url(#orbGrad)" opacity="0.6" />
          </g>
          <circle cx={CX} cy={CY} r="46" fill="none" stroke="url(#rim)" strokeWidth="3" filter="url(#glow)" />
        </g>

        {/* ses tepkisi: Nova konuşurken genişleyen halkalar */}
        {speaking && (
          <g>
            <circle cx={CX} cy={CY} r="46" fill="none" stroke="#22d3ee" strokeWidth="3">
              <animate attributeName="r" values="46;118" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={CX} cy={CY} r="46" fill="none" stroke="#67e8f9" strokeWidth="2">
              <animate attributeName="r" values="46;118" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
        {/* dinlerken nazik nabız */}
        {listening && (
          <circle cx={CX} cy={CY} r="52" fill="none" stroke="#22d3ee" strokeWidth="2">
            <animate attributeName="r" values="50;66;50" dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
        {/* yönlendirme halkası */}
        {orchActive && (
          <circle cx={CX} cy={CY} r="54" fill="none" stroke="#a855f7" strokeWidth="2">
            <animate attributeName="r" from="50" to="86" dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.8" to="0" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}

        {/* ajan düğümleri */}
        {AGENT_KEYS.map((key, i) => {
          const p = POS[key];
          const meta = AGENT_META[key];
          const on = active === key;
          return (
            <g key={key} className="map-node" style={{ animationDelay: `${i * 0.5}s` }}>
              {on && (
                <circle cx={p.x} cy={p.y} r="14" fill="none" stroke={meta.color} strokeWidth="2">
                  <animate attributeName="r" from="12" to="26" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.9" to="0" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y} r={on ? 11 : 9} fill="none" stroke={meta.color} strokeWidth="2.5" strokeOpacity={on ? 1 : 0.7} filter={on ? "url(#glow)" : undefined} />
              <circle cx={p.x} cy={p.y} r={on ? 5 : 3.5} fill={meta.color} />
              <text x={p.x} y={p.y - 22} textAnchor="middle" fontSize="17" fontWeight={600} fill={on ? meta.color : "#dbe6f5"} style={{ paintOrder: "stroke", stroke: "#02040a", strokeWidth: 3 }}>
                {meta.emoji} {meta.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* tam ekran düğmesi */}
      <button
        onClick={toggleFullscreen}
        title="Tam ekran aç/kapat"
        className="btn-grad absolute right-3 top-3 z-20 rounded-lg px-2.5 py-1 text-sm"
        style={{
          background: "rgba(4,8,18,0.6)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        ⛶
      </button>

      {/* ses kontrolü — tıklanabilir mikrofon + dalga */}
      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <button
          onClick={onMic}
          title="Konuşmak için tıkla (veya Boşluk tuşu)"
          className="btn-grad flex items-center gap-3 rounded-full px-5 py-2"
          style={{
            background: "rgba(4,8,18,0.6)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${listening ? "#ef4444" : "var(--border)"}`,
          }}
        >
          <span className="text-base">{listening ? "🔴" : "🎤"}</span>
          <Wave color={listening ? "#ef4444" : "var(--accent)"} active={voice !== "idle"} />
        </button>
        <span className="text-[10px] font-semibold tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>
          {listening
            ? "DİNLİYOR"
            : speaking
              ? "KONUŞUYOR"
              : wakeOn
                ? "'NOVA' DE"
                : "KONUŞMAK İÇİN BAS"}
        </span>
        <button
          onClick={onToggleWake}
          title="'Nova' diyerek sesle uyandır"
          className="rounded-full px-3 py-1 text-[11px] font-medium"
          style={{
            background: wakeOn ? "#10b98122" : "rgba(4,8,18,0.6)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${wakeOn ? "#10b981" : "var(--border)"}`,
            color: wakeOn ? "#10b981" : "var(--text-muted)",
          }}
        >
          {wakeOn ? "👂 'Nova' dinleniyor — kapat" : "👂 'Nova' ile uyandır"}
        </button>
      </div>
    </div>
  );
}
