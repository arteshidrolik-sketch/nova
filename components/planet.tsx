// Proje gezegeni görünümü: başlıktan türetilen kararlı palet + küre gölgelemesi,
// atmosfer ışıması, isteğe bağlı halka ve yüzey bantları. Saf CSS (görüntü yok).
import type { CSSProperties } from "react";

// Sınırlı, ayırt edilebilir 8 gezegen paleti [açık, ana, koyu, atmosfer]
const PALETTES: [string, string, string, string][] = [
  ["#a5f3fc", "#22d3ee", "#0e4a5c", "rgba(34,211,238,.45)"], // camgöbeği
  ["#ddd6fe", "#8b5cf6", "#2e1065", "rgba(139,92,246,.45)"], // mor
  ["#fecaca", "#f87171", "#5c1414", "rgba(248,113,113,.4)"], // mercan
  ["#fde68a", "#f59e0b", "#5a3505", "rgba(245,158,11,.4)"], // kehribar
  ["#a7f3d0", "#10b981", "#063d2c", "rgba(16,185,129,.42)"], // zümrüt
  ["#fbcfe8", "#ec4899", "#4c0a2c", "rgba(236,72,153,.4)"], // gül
  ["#bfdbfe", "#3b82f6", "#0f2a5c", "rgba(59,130,246,.45)"], // gök
  ["#e7e5e4", "#a8a29e", "#2b2724", "rgba(214,211,209,.3)"], // kum
];

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type PlanetLook = { light: string; base: string; dark: string; glow: string; ring: boolean; bands: boolean; tilt: number };
export function planetLook(seed: string): PlanetLook {
  const h = hashStr(seed);
  const [light, base, dark, glow] = PALETTES[h % PALETTES.length];
  return { light, base, dark, glow, ring: (h >> 4) % 3 === 0, bands: (h >> 7) % 2 === 0, tilt: ((h >> 9) % 40) - 20 };
}

export function Planet({ seed, size, spin = true, style }: { seed: string; size: number; spin?: boolean; style?: CSSProperties }) {
  const L = planetLook(seed);
  const sphere: CSSProperties = {
    position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
    background: `radial-gradient(circle at 32% 30%, ${L.light} 0%, ${L.base} 38%, ${L.dark} 100%)`,
    boxShadow: `0 0 ${size * 0.35}px ${L.glow}, inset -${size * 0.16}px -${size * 0.12}px ${size * 0.28}px rgba(0,0,0,.65)`,
  };
  return (
    <div style={{ position: "relative", width: size, height: size, ...style }}>
      {L.ring && (
        <div aria-hidden style={{
          position: "absolute", left: "50%", top: "50%", width: size * 1.9, height: size * 0.5,
          transform: `translate(-50%,-50%) rotate(${L.tilt}deg)`, borderRadius: "50%",
          border: `${Math.max(2, size * 0.05)}px solid ${L.light}`, opacity: 0.45,
          boxShadow: `0 0 ${size * 0.12}px ${L.glow}`,
        }} />
      )}
      <div style={sphere}>
        {L.bands && (
          <div aria-hidden className={spin ? "planet-spin" : undefined} style={{
            position: "absolute", inset: "-10% -60%", opacity: 0.32, mixBlendMode: "overlay",
            background: `repeating-linear-gradient(${L.tilt}deg, transparent 0 ${size * 0.08}px, ${L.light} ${size * 0.08}px ${size * 0.12}px, transparent ${size * 0.12}px ${size * 0.2}px)`,
          }} />
        )}
        {/* terminatör: gece tarafı */}
        <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 75% 78%, rgba(0,0,0,.55), transparent 58%)" }} />
      </div>
      {/* halkanın önde kalan yarısı */}
      {L.ring && (
        <div aria-hidden style={{
          position: "absolute", left: "50%", top: "50%", width: size * 1.9, height: size * 0.5,
          transform: `translate(-50%,-50%) rotate(${L.tilt}deg)`, borderRadius: "50%",
          borderBottom: `${Math.max(2, size * 0.05)}px solid ${L.light}`, borderTop: "0 solid transparent",
          borderLeft: "0 solid transparent", borderRight: "0 solid transparent", opacity: 0.55,
          clipPath: "inset(50% 0 0 0)",
        }} />
      )}
    </div>
  );
}
