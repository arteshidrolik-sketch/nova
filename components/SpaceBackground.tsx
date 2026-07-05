"use client";

import { useEffect, useRef } from "react";

/**
 * SpaceBackground
 * ----------------
 * Sıfır bağımlılıklı, canvas tabanlı, hareketli 3B derinlikli uzay arka planı.
 * - AgentMap'in en ALT katmanı (z-0) — eski NASA fotoğrafının yerini alır.
 * - Katmanlı parallax: uzak nebula bulutları → orta toz yıldızlar → yakın parlak
 *   yıldızlar. Fare hareketiyle her katman farklı hızda kayar → gerçek derinlik.
 * - Bilim/uzay teması: nefes alan renkli nebulalar, kayan kuyruklu yıldızlar,
 *   yörüngede dönen "atom" parçacıkları.
 * - prefers-reduced-motion, sekme gizliyken duraklatma, DPR sınırı ile performanslı.
 * - pointer-events:none → arayüzü asla bloklamaz.
 */

type Neb = {
  x: number; y: number; r: number;
  h: number; s: number; l: number;
  a: number; dx: number; dy: number;
  ph: number; ps: number; depth: number;
};
type Dust = {
  x: number; y: number; r: number;
  tw: number; twp: number; depth: number; c: string;
};
type Atom = {
  x: number; y: number; r: number;
  hue: number; rot: number; spin: number;
  tilt: number; depth: number; e: number;
};
type Comet = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; len: number; hue: number;
};

const NEB_COLORS = [
  [190, 90, 60],  // cyan
  [217, 85, 58],  // mavi
  [275, 80, 62],  // mor
  [330, 78, 58],  // magenta
  [190, 70, 50],  // teal
];
const STAR_TINT = ["#ffffff", "#dbeafe", "#bfdbfe", "#fde68a", "#fecaca", "#c7f9ff"];

const R = () => Math.random();

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement as HTMLElement | null;
    if (!host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1;
    let mx = 0, my = 0, tmx = 0, tmy = 0; // fare parallax (yumuşatılmış)
    let t = 0;

    const nebs: Neb[] = [];
    const dust: Dust[] = [];
    const atoms: Atom[] = [];
    const comets: Comet[] = [];

    function build() {
      nebs.length = 0;
      dust.length = 0;
      atoms.length = 0;
      // Nebula bulutları — büyük, yumuşak, nefes alan
      const nebCount = 6;
      for (let i = 0; i < nebCount; i++) {
        const c = NEB_COLORS[i % NEB_COLORS.length];
        nebs.push({
          x: R() * w, y: R() * h,
          r: Math.max(w, h) * (0.28 + R() * 0.34),
          h: c[0] + (R() * 20 - 10), s: c[1], l: c[2],
          a: 0.1 + R() * 0.16,
          dx: (R() - 0.5) * 0.06, dy: (R() - 0.5) * 0.05,
          ph: R() * Math.PI * 2, ps: 0.0006 + R() * 0.0008,
          depth: 0.15 + R() * 0.35,
        });
      }
      // Toz yıldızlar — çok katmanlı parallax
      const dustCount = Math.round((w * h) / 5200);
      for (let i = 0; i < dustCount; i++) {
        const depth = R();
        dust.push({
          x: R() * w, y: R() * h,
          r: 0.4 + depth * 1.6,
          tw: 1.5 + R() * 4, twp: R() * Math.PI * 2,
          depth: 0.05 + depth * 0.9,
          c: STAR_TINT[Math.floor(R() * STAR_TINT.length)],
        });
      }
      // "Atom"lar — yörüngede elektronu dönen bilim öğesi
      const atomCount = 5;
      for (let i = 0; i < atomCount; i++) {
        atoms.push({
          x: R() * w, y: R() * h,
          r: 16 + R() * 26,
          hue: [190, 217, 275, 330, 160][i % 5],
          rot: R() * Math.PI * 2, spin: (R() - 0.5) * 0.02,
          tilt: R() * Math.PI, depth: 0.2 + R() * 0.5,
          e: 2 + Math.floor(R() * 2), // elektron sayısı
        });
      }
    }

    function resize() {
      const rect = host!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    window.addEventListener("resize", resize);

    function onMove(e: MouseEvent) {
      const rect = host!.getBoundingClientRect();
      tmx = (e.clientX - rect.left) / w - 0.5;
      tmy = (e.clientY - rect.top) / h - 0.5;
    }
    window.addEventListener("mousemove", onMove);

    function spawnComet() {
      const edge = R();
      const startX = edge < 0.5 ? R() * w * 0.5 : w * (0.5 + R() * 0.5);
      const startY = -40;
      const dir = edge < 0.5 ? 1 : -1;
      const sp = 6 + R() * 6;
      comets.push({
        x: startX, y: startY,
        vx: dir * sp * (0.5 + R() * 0.5), vy: sp,
        life: 0, max: 60 + R() * 40,
        len: 80 + R() * 120,
        hue: [190, 275, 330, 45][Math.floor(R() * 4)],
      });
    }

    let raf = 0;
    let running = true;

    function frame() {
      if (!running) return;
      t += 1;
      mx += (tmx - mx) * 0.04;
      my += (tmy - my) * 0.04;

      // --- Derin uzay taban gradyanı (opak) ---
      const base = ctx!.createLinearGradient(0, 0, w * 0.3, h);
      base.addColorStop(0, "#05070f");
      base.addColorStop(0.5, "#070914");
      base.addColorStop(1, "#03040b");
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = base;
      ctx!.fillRect(0, 0, w, h);

      // --- Nebula bulutları (parlama karışımı) ---
      ctx!.globalCompositeOperation = "lighter";
      for (const n of nebs) {
        if (!reduced) {
          n.x += n.dx; n.y += n.dy;
          if (n.x < -n.r) n.x = w + n.r;
          if (n.x > w + n.r) n.x = -n.r;
          if (n.y < -n.r) n.y = h + n.r;
          if (n.y > h + n.r) n.y = -n.r;
        }
        const pulse = 0.75 + Math.sin(t * n.ps * 60 + n.ph) * 0.25;
        const px = n.x + mx * 60 * n.depth;
        const py = n.y + my * 60 * n.depth;
        const rr = n.r * pulse;
        const g = ctx!.createRadialGradient(px, py, 0, px, py, rr);
        g.addColorStop(0, `hsla(${n.h},${n.s}%,${n.l}%,${n.a})`);
        g.addColorStop(0.45, `hsla(${n.h},${n.s}%,${n.l}%,${n.a * 0.45})`);
        g.addColorStop(1, `hsla(${n.h},${n.s}%,${n.l}%,0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(px, py, rr, 0, Math.PI * 2);
        ctx!.fill();
      }

      // --- Toz yıldızlar (parallax + parıltı) ---
      for (const d of dust) {
        const tw = reduced ? 0.8 : 0.55 + Math.sin(t / (d.tw * 6) + d.twp) * 0.45;
        const px = d.x + mx * 90 * d.depth;
        const py = d.y + my * 90 * d.depth;
        ctx!.globalAlpha = tw;
        ctx!.fillStyle = d.c;
        ctx!.beginPath();
        ctx!.arc(px, py, d.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // --- Atomlar (yörüngede elektron) ---
      for (const a of atoms) {
        if (!reduced) a.rot += a.spin;
        const px = a.x + mx * 70 * a.depth;
        const py = a.y + my * 70 * a.depth;
        const col = `hsl(${a.hue},85%,65%)`;
        // çekirdek
        const core = ctx!.createRadialGradient(px, py, 0, px, py, a.r * 0.5);
        core.addColorStop(0, `hsla(${a.hue},95%,80%,0.9)`);
        core.addColorStop(1, `hsla(${a.hue},95%,60%,0)`);
        ctx!.fillStyle = core;
        ctx!.beginPath();
        ctx!.arc(px, py, a.r * 0.5, 0, Math.PI * 2);
        ctx!.fill();
        // yörüngeler + elektronlar
        ctx!.strokeStyle = `hsla(${a.hue},80%,65%,0.28)`;
        ctx!.lineWidth = 1;
        for (let k = 0; k < a.e; k++) {
          const ang = (Math.PI / a.e) * k + a.tilt;
          ctx!.save();
          ctx!.translate(px, py);
          ctx!.rotate(ang);
          ctx!.beginPath();
          ctx!.ellipse(0, 0, a.r, a.r * 0.4, 0, 0, Math.PI * 2);
          ctx!.stroke();
          // elektron
          const ep = a.rot * (1 + k * 0.3) + k;
          const ex = Math.cos(ep) * a.r;
          const ey = Math.sin(ep) * a.r * 0.4;
          ctx!.fillStyle = col;
          ctx!.beginPath();
          ctx!.arc(ex, ey, 1.8, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.restore();
        }
      }

      // --- Kuyruklu yıldızlar ---
      if (!reduced && comets.length < 2 && R() < 0.004) spawnComet();
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.x += c.vx; c.y += c.vy; c.life += 1;
        const fade =
          c.life < 12 ? c.life / 12 : Math.max(0, 1 - (c.life - 12) / (c.max - 12));
        const tailX = c.x - c.vx * (c.len / 8);
        const tailY = c.y - c.vy * (c.len / 8);
        const grad = ctx!.createLinearGradient(c.x, c.y, tailX, tailY);
        grad.addColorStop(0, `hsla(${c.hue},95%,80%,${fade})`);
        grad.addColorStop(1, `hsla(${c.hue},95%,70%,0)`);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 2;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(c.x, c.y);
        ctx!.lineTo(tailX, tailY);
        ctx!.stroke();
        ctx!.fillStyle = `hsla(${c.hue},100%,90%,${fade})`;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, 2.2, 0, Math.PI * 2);
        ctx!.fill();
        if (c.life > c.max || c.y > h + 60 || c.x < -60 || c.x > w + 60)
          comets.splice(i, 1);
      }

      ctx!.globalCompositeOperation = "source-over";

      // reduced-motion: tek kare yeter
      if (reduced) return;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && !reduced) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
