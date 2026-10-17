"use client";

// Gerçekçi gezegen: gerçek yüzey dokusu (eşdikdörtgen harita, Solar System Scope,
// CC BY 4.0) küreye izdüşürülüp kendi ekseninde döner. Her piksel için küre
// üzerindeki enlem/boylam ve ışık şiddeti bir kez hesaplanır; her karede yalnız
// boylam kaydırılıp dokudan örneklenir (ucuz). Dünya'da ayrı dönen bulut katmanı
// + atmosfer kenar ışıması; halkalı türde gerçek halka dokusu (önü/arkası doğru).
import { useEffect, useRef, type CSSProperties } from "react";

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

type Kind = { tex: string; clouds?: string; ring?: boolean; atmo?: [number, number, number]; period: number };
const EARTH: Kind = { tex: "earth_daymap", clouds: "earth_clouds", atmo: [110, 170, 255], period: 70 };
// Projelere dağıtılan gezegen türleri (Dünya merkezdeki Nova'ya ayrılmış)
const KINDS: Kind[] = [
  { tex: "mars", atmo: [255, 150, 110], period: 60 },
  { tex: "jupiter", period: 40 },
  { tex: "saturn", ring: true, period: 45 },
  { tex: "neptune", atmo: [90, 140, 255], period: 55 },
  { tex: "venus_atmosphere", atmo: [255, 220, 160], period: 90 },
  { tex: "uranus", ring: true, atmo: [150, 230, 240], period: 65 },
  { tex: "mercury", period: 80 },
  { tex: "moon", period: 85 },
  { tex: "ceres_fictional", period: 70 },
  { tex: "haumea_fictional", period: 50 },
  { tex: "makemake_fictional", atmo: [255, 190, 140], period: 75 },
  { tex: "eris_fictional", period: 95 },
];
export function kindFor(seed: string, earth = false): Kind {
  return earth ? EARTH : KINDS[hashStr(seed) % KINDS.length];
}

// Doku önbelleği: url → piksel verisi
type Tex = { w: number; h: number; d: Uint8ClampedArray };
const cache = new Map<string, Promise<Tex>>();
function loadTex(url: string): Promise<Tex> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<Tex>((res, rej) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.drawImage(img, 0, 0);
        res({ w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data });
      };
      img.onerror = rej;
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

const LIGHT = (() => { const v = [-0.62, -0.38, 0.69]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
const RING_IN = 1.25, RING_OUT = 2.2, RING_FLAT = 0.3;

export function Planet({
  seed, size: box, spin = true, earth = false, style, fit = false,
}: { seed: string; size: number; spin?: boolean; earth?: boolean; style?: CSSProperties; fit?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const K = kindFor(seed, earth);
  // fit: halka dahil yer kaplasın (sekme gibi dar yerlerde yazının üstüne taşmasın)
  const size = fit && K.ring ? Math.round(box * 0.7) : box;
  const tilt = ((hashStr(seed + "t") % 50) - 25) * (Math.PI / 180) * (earth ? 0.5 : 1);
  const phase0 = (hashStr(seed + "p") % 1000) / 1000;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let alive = true, raf = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const D = Math.max(16, Math.round(size * dpr)); // küre çapı (px)
    const ringScale = K.ring ? RING_OUT : 1;
    const W = Math.round(D * ringScale) + 2, H = K.ring ? Math.round(D * 1.15) + 2 : D + 2;
    cv.width = W; cv.height = H;
    const cx = W / 2, cy = H / 2, r = D / 2;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

    Promise.all([
      loadTex(`/planets/${K.tex}.webp`),
      K.clouds ? loadTex(`/planets/${K.clouds}.webp`) : Promise.resolve(null),
      K.ring ? loadTex(`/planets/saturn_ring.png`) : Promise.resolve(null),
    ]).then(([tex, clouds, ring]) => {
      if (!alive) return;
      // --- önhesap: küre pikselleri ---
      type Px = { o: number; u: number; v: number; vc: number; shade: number; a: number; rim: number; ringFront: boolean };
      const sph: Px[] = [];
      const ringPx: { o: number; t: number; lit: number; front: boolean }[] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
          const d2 = dx * dx + dy * dy;
          // halka düzlemi (eksen eğikliğiyle döndürülmüş, basık elips)
          if (K.ring && ring) {
            const rx = dx * cosT + dy * sinT, ry = (-dx * sinT + dy * cosT) / RING_FLAT;
            const rr = Math.hypot(rx, ry);
            if (rr >= RING_IN && rr <= RING_OUT) {
              const front = ry > 0;
              if (d2 >= 1 || front) ringPx.push({ o: (y * W + x) * 4, t: (rr - RING_IN) / (RING_OUT - RING_IN), lit: 0.82, front });
            }
          }
          if (d2 > 1.02) continue;
          const dist = Math.sqrt(d2);
          const a = Math.max(0, Math.min(1, (1 - dist) * r + 0.5)); // kenar yumuşatma
          if (a <= 0) continue;
          const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)));
          // eksen eğikliği: görüş ekseni etrafında döndür → enlem/boylam
          const tx = dx * cosT + dy * sinT, ty = -dx * sinT + dy * cosT;
          const lat = Math.asin(Math.max(-1, Math.min(1, ty)));
          const lon = Math.atan2(tx, nz);
          const diff = Math.max(0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]);
          const shade = 0.035 + 0.965 * Math.pow(diff, 0.85) * (0.82 + 0.18 * nz);
          sph.push({
            o: (y * W + x) * 4,
            u: (lon / (2 * Math.PI) + 0.5) * tex.w,
            v: Math.min(tex.h - 1, Math.max(0, Math.round((lat / Math.PI + 0.5) * (tex.h - 1)))) * tex.w,
            vc: clouds ? Math.min(clouds.h - 1, Math.max(0, Math.round((lat / Math.PI + 0.5) * (clouds.h - 1)))) * clouds.w : 0,
            shade, a, rim: Math.pow(1 - nz, 2.6) * (0.35 + 0.65 * Math.max(0, diff + 0.25)), ringFront: false,
          });
        }
      }
      const img = ctx.createImageData(W, H);
      const out = img.data;
      const cw = clouds ? clouds.w / tex.w : 1;
      const atmo = K.atmo;
      const t0 = performance.now();
      let last = 0;
      const draw = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(draw);
        if (now - last < 42) return; // ~24 fps
        last = now;
        const turns = spin && !reduced ? (now - t0) / 1000 / K.period : 0;
        const rot = ((phase0 + turns) % 1) * tex.w;
        const crot = ((phase0 * 1.7 + turns * 1.12) % 1) * (clouds ? clouds.w : 1);
        out.fill(0);
        // halka (arka yarı ve gezegen dışı)
        if (ring) for (const p of ringPx) {
          if (p.front) continue;
          const i = Math.min(ring.w - 1, Math.floor(p.t * (ring.w - 1))) * 4;
          out[p.o] = ring.d[i] * p.lit; out[p.o + 1] = ring.d[i + 1] * p.lit; out[p.o + 2] = ring.d[i + 2] * p.lit; out[p.o + 3] = ring.d[i + 3];
        }
        const td = tex.d, tw = tex.w;
        for (let k = 0; k < sph.length; k++) {
          const p = sph[k];
          let ui = (p.u + rot) | 0; ui %= tw; if (ui < 0) ui += tw;
          const i = (p.v + ui) * 4;
          let R = td[i], G = td[i + 1], B = td[i + 2];
          if (clouds) {
            let uc = ((p.u * cw + crot) | 0) % clouds.w; if (uc < 0) uc += clouds.w;
            const c = clouds.d[(p.vc + uc) * 4] / 255;
            const ca = Math.min(1, c * 1.15);
            R += (255 - R) * ca; G += (255 - G) * ca; B += (255 - B) * ca;
          }
          R *= p.shade; G *= p.shade; B *= p.shade;
          if (atmo) { R += atmo[0] * p.rim; G += atmo[1] * p.rim; B += atmo[2] * p.rim; }
          // gezegen piksellerini halkanın arka yarısının üstüne bindir
          const o = p.o, a = p.a;
          out[o] = R * a + out[o] * (1 - a); out[o + 1] = G * a + out[o + 1] * (1 - a); out[o + 2] = B * a + out[o + 2] * (1 - a);
          out[o + 3] = Math.max(out[o + 3], a * 255);
        }
        // halka ön yarı (gezegenin önünden geçer)
        if (ring) for (const p of ringPx) {
          if (!p.front) continue;
          const i = Math.min(ring.w - 1, Math.floor(p.t * (ring.w - 1))) * 4;
          const ra = ring.d[i + 3] / 255;
          out[p.o] = ring.d[i] * p.lit * ra + out[p.o] * (1 - ra);
          out[p.o + 1] = ring.d[i + 1] * p.lit * ra + out[p.o + 1] * (1 - ra);
          out[p.o + 2] = ring.d[i + 2] * p.lit * ra + out[p.o + 2] * (1 - ra);
          out[p.o + 3] = Math.max(out[p.o + 3], ring.d[i + 3]);
        }
        ctx.putImageData(img, 0, 0);
      };
      raf = requestAnimationFrame(draw);
    }).catch(() => { /* doku yüklenemezse boş kalır */ });

    const onVis = () => { /* sekme gizliyken rAF zaten durur */ };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, [seed, size, spin, earth, K, tilt, phase0]);

  const ringScale = K.ring ? RING_OUT : 1;
  // yalnız atmosferi olan gezegenlerde yumuşak ışıma (havasızlarda hale olmasın)
  const glow = K.atmo ? `rgba(${K.atmo[0]},${K.atmo[1]},${K.atmo[2]},.28)` : "";
  return (
    <div style={{ position: "relative", width: fit ? Math.ceil(size * ringScale) : size, height: fit ? box : size, flexShrink: 0, ...style }}>
      {/* yumuşak atmosfer ışıması */}
      {glow && <div aria-hidden style={{ position: "absolute", inset: size * 0.04, borderRadius: "50%", boxShadow: `0 0 ${size * 0.3}px ${glow}` }} />}
      <canvas
        ref={ref}
        aria-hidden
        style={{
          position: "absolute", left: "50%", top: "50%",
          width: size * ringScale, height: K.ring ? size * 1.15 : size,
          transform: "translate(-50%,-50%)",
        }}
      />
    </div>
  );
}
