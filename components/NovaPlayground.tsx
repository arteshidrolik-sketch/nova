"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * NovaPlayground
 * -----------------
 * Sıfır bağımlılıklı, canvas tabanlı 3D arka plan + mini oyun.
 * - Normalde pointer-events:none => ana arayüzü ASLA bloklamaz.
 * - Sağ alttaki buton "Oyun Modu"nu açar: orb patlatma + combo + skor.
 * - prefers-reduced-motion, sekme gizliyken duraklatma, DPR sınırı.
 */

type Star = { x: number; y: number; z: number };
type Orb = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  hue: number;
  r: number;
  dead: boolean;
  pop: number; // patlama animasyonu 0..1
};

const STAR_COUNT = 320;
const ORB_COUNT = 14;
const FOV = 260;

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function NovaPlayground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playMode, setPlayMode] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [combo, setCombo] = useState(0);

  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const comboTimer = useRef<number>(0);

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem("nova_playground_best") || "0");
      if (!Number.isNaN(b)) setBest(b);
    } catch {}
  }, []);

  const bump = useCallback((points: number) => {
    comboRef.current += 1;
    comboTimer.current = 90; // ~1.5s @60fps
    const gained = points * Math.max(1, comboRef.current);
    scoreRef.current += gained;
    setScore(scoreRef.current);
    setCombo(comboRef.current);
    setBest((prev) => {
      const nb = Math.max(prev, scoreRef.current);
      try {
        localStorage.setItem("nova_playground_best", String(nb));
      } catch {}
      return nb;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let dpr = 1;

    const stars: Star[] = [];
    const orbs: Orb[] = [];

    function resetStar(s: Star) {
      s.x = rand(-w, w);
      s.y = rand(-h, h);
      s.z = rand(1, FOV * 4);
    }

    function spawnOrb(o?: Orb): Orb {
      const orb: Orb = o || ({} as Orb);
      orb.x = rand(-w * 0.7, w * 0.7);
      orb.y = rand(-h * 0.7, h * 0.7);
      orb.z = rand(FOV, FOV * 3.2);
      orb.vx = rand(-0.15, 0.15);
      orb.vy = rand(-0.15, 0.15);
      orb.hue = rand(180, 320);
      orb.r = rand(10, 22);
      orb.dead = false;
      orb.pop = 0;
      return orb;
    }

    for (let i = 0; i < STAR_COUNT; i++) {
      const s: Star = { x: 0, y: 0, z: 0 };
      resetStar(s);
      stars.push(s);
    }
    for (let i = 0; i < ORB_COUNT; i++) orbs.push(spawnOrb());

    let mx = 0;
    let my = 0;
    let tmx = 0;
    let tmy = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2); // performans için sınırlı
      w = window.innerWidth;
      h = window.innerHeight;
      cx = w / 2;
      cy = h / 2;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function onMove(e: MouseEvent) {
      tmx = (e.clientX - cx) / cx;
      tmy = (e.clientY - cy) / cy;
    }
    window.addEventListener("mousemove", onMove);

    function project(x: number, y: number, z: number) {
      const scale = FOV / (FOV + z);
      return {
        sx: cx + (x + mx * 40) * scale,
        sy: cy + (y + my * 40) * scale,
        scale,
      };
    }

    function onClick(e: MouseEvent) {
      if (!playModeRef.current) return;
      const px = e.clientX;
      const py = e.clientY;
      let hit = false;
      // en yakın (en büyük) orb önce
      const sorted = [...orbs]
        .filter((o) => !o.dead)
        .sort((a, b) => a.z - b.z);
      for (const o of sorted) {
        const p = project(o.x, o.y, o.z);
        const rad = o.r * p.scale + 10;
        const d = Math.hypot(px - p.sx, py - p.sy);
        if (d <= rad) {
          o.dead = true;
          o.pop = 0.001;
          bump(10);
          hit = true;
          break;
        }
      }
      if (!hit) {
        // ıskalama combo'yu sıfırlar
        comboRef.current = 0;
        setCombo(0);
      }
    }
    window.addEventListener("click", onClick);

    let raf = 0;
    let running = true;

    function frame() {
      if (!running) return;
      mx += (tmx - mx) * 0.05;
      my += (tmy - my) * 0.05;

      ctx!.clearRect(0, 0, w, h);

      // hafif derinlik sisi
      const bg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      bg.addColorStop(0, "rgba(60,40,120,0.05)");
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = bg;
      ctx!.fillRect(0, 0, w, h);

      // yıldız tüneli
      const speed = reduced ? 0.6 : playModeRef.current ? 3.4 : 2.0;
      for (const s of stars) {
        s.z -= speed;
        if (s.z < 1) {
          resetStar(s);
          s.z = FOV * 4;
        }
        const p = project(s.x, s.y, s.z);
        if (p.sx < 0 || p.sx > w || p.sy < 0 || p.sy > h) continue;
        const size = Math.max(0.4, 2.2 * p.scale);
        const alpha = Math.min(1, p.scale * 1.6);
        ctx!.fillStyle = `rgba(200,220,255,${alpha * 0.9})`;
        ctx!.fillRect(p.sx, p.sy, size, size);
      }

      // orb'lar (derinliğe göre çizim, uzak önce)
      const drawList = [...orbs].sort((a, b) => b.z - a.z);
      for (const o of drawList) {
        if (o.dead && o.pop <= 0) continue;

        if (!o.dead && !reduced) {
          o.x += o.vx;
          o.y += o.vy;
          o.z -= 0.25;
          if (o.z < FOV * 0.6) o.z = FOV * 0.6;
          if (Math.abs(o.x) > w) o.vx *= -1;
          if (Math.abs(o.y) > h) o.vy *= -1;
        }

        const p = project(o.x, o.y, o.z);
        let radius = o.r * p.scale;
        let alpha = Math.min(1, p.scale * 1.4);

        if (o.dead) {
          o.pop += 0.06;
          radius = o.r * p.scale * (1 + o.pop * 2.2);
          alpha = Math.max(0, 1 - o.pop);
          if (o.pop >= 1) {
            // yeni orb doğur
            spawnOrb(o);
            continue;
          }
        }

        const grad = ctx!.createRadialGradient(
          p.sx,
          p.sy,
          0,
          p.sx,
          p.sy,
          Math.max(1, radius * 2.4)
        );
        grad.addColorStop(0, `hsla(${o.hue},90%,70%,${alpha})`);
        grad.addColorStop(0.4, `hsla(${o.hue},90%,60%,${alpha * 0.5})`);
        grad.addColorStop(1, `hsla(${o.hue},90%,50%,0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, Math.max(1, radius * 2.4), 0, Math.PI * 2);
        ctx!.fill();

        // çekirdek
        ctx!.fillStyle = `hsla(${o.hue},100%,85%,${alpha})`;
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, Math.max(0.5, radius * 0.5), 0, Math.PI * 2);
        ctx!.fill();
      }

      // combo zamanlayıcı
      if (comboTimer.current > 0) {
        comboTimer.current -= 1;
        if (comboTimer.current === 0 && comboRef.current > 0) {
          comboRef.current = 0;
          setCombo(0);
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bump]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: playMode ? "auto" : "none",
          cursor: playMode ? "crosshair" : "default",
        }}
      />

      {/* Oyun modu HUD */}
      {playMode && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            pointerEvents: "none",
            display: "flex",
            gap: 12,
            alignItems: "center",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            color: "#e7e9ff",
            background: "rgba(20,16,40,0.55)",
            border: "1px solid rgba(150,140,255,0.25)",
            borderRadius: 999,
            padding: "6px 16px",
            backdropFilter: "blur(8px)",
          }}
        >
          <span>Skor: {score}</span>
          <span style={{ opacity: 0.5 }}>|</span>
          <span>Rekor: {best}</span>
          {combo > 1 && (
            <>
              <span style={{ opacity: 0.5 }}>|</span>
              <span style={{ color: "#8affc1" }}>x{combo} combo!</span>
            </>
          )}
        </div>
      )}

      {/* Aç/kapa butonu */}
      <button
        type="button"
        onClick={() => {
          if (playMode) {
            // kapatırken combo/skor sıfırla
            scoreRef.current = 0;
            comboRef.current = 0;
            setScore(0);
            setCombo(0);
          }
          setPlayMode((v) => !v);
        }}
        aria-pressed={playMode}
        title={playMode ? "Oyunu kapat" : "Beklerken oyna: orb'lara tıkla!"}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 40,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid rgba(150,140,255,0.35)",
          background: playMode
            ? "rgba(130,90,255,0.85)"
            : "rgba(20,16,40,0.6)",
          color: "#f2f0ff",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          transition: "background 200ms ease, transform 200ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="6" y1="11" x2="10" y2="11" />
          <line x1="8" y1="9" x2="8" y2="13" />
          <line x1="15" y1="12" x2="15.01" y2="12" />
          <line x1="18" y1="10" x2="18.01" y2="10" />
          <path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.06.6-.44 4.24-.44 5.41A2.5 2.5 0 0 0 4.76 16.5c.85 0 1.62-.43 2.08-1.15l.51-.8a2 2 0 0 1 1.69-.93h5.92a2 2 0 0 1 1.69.93l.51.8c.46.72 1.23 1.15 2.08 1.15a2.5 2.5 0 0 0 2.5-2.5c0-1.17-.38-4.81-.44-5.41A4 4 0 0 0 17.32 5z" />
        </svg>
        {playMode ? "Oyunu kapat" : "Oyna"}
      </button>
    </>
  );
}
