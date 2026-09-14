"use client";

import { useEffect, useRef, useState } from "react";
import { type AgentActivity } from "@/lib/agents/meta";

export type VoiceState = "idle" | "listening" | "speaking";

// Ajanların radar üzerindeki sabit konumları
const RADAR_POS: { name: string; ang: number; rr: number; c: string }[] = [
  { name: "ARAŞTIRMA", ang: -2.5, rr: 0.82, c: "#4fd8ff" },
  { name: "GENEL", ang: -1.15, rr: 0.6, c: "#c084fc" },
  { name: "KOD", ang: -0.15, rr: 0.86, c: "#f472b6" },
  { name: "SÜRÜM", ang: 0.75, rr: 0.66, c: "#fbbf24" },
  { name: "PROJE", ang: 1.7, rr: 0.83, c: "#34d399" },
  { name: "GELİŞTİRİCİ", ang: 2.75, rr: 0.6, c: "#60a5fa" },
];

/**
 * RadarGame — sabit dairesel radar (üstte, yarı saydam) + arkada 3B hava savaşı.
 * Nişan: fare imleci nişangâhtır; TIKLAYINCA nişangâhtaki düşmana ateş edilir.
 * "Başla" ile oyun açılır; can biterse "Tekrar oyna". mini modda sadece radar.
 */
export default function RadarGame({
  mini = false,
}: {
  active?: AgentActivity;
  voice?: VoiceState;
  customAgents?: unknown;
  mini?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<() => void>(() => {});
  const [hud, setHud] = useState({ score: 0, lives: 3, started: false, over: false });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isMini = mini;

    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, Rr = 0, U = 100;
    let sweep = -Math.PI / 2, tf = 0, corePulse = 0;

    type Enemy = { ex: number; ez: number; speed: number; wob: number; sx: number; sy: number; rad: number };
    type Tracer = { x1: number; y1: number; x2: number; y2: number; life: number; hit: boolean };
    type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string };
    type Star = { x: number; y: number; v: number; r: number };
    const enemies: Enemy[] = [];
    const tracers: Tracer[] = [];
    const parts: Part[] = [];
    const stars: Star[] = [];
    const ret = { x: 0, y: 0 };       // nişangâh (fare)
    let jsx = 0, jsy = 0, jetEx = 0;  // uçağın ekran konumu + yatay dünya konumu
    let started = false, over = false, score = 0, lives = 3;
    let lastSpawn = 0, lastFire = 0, spawnEvery = 46, hudDirty = false;

    function buildStars() {
      stars.length = 0;
      const n = Math.round((W * H) / 6500);
      for (let i = 0; i < n; i++)
        stars.push({ x: Math.random() * W, y: Math.random() * (H * 0.4), v: 0.3 + Math.random() * 1.0, r: 0.4 + Math.random() * 1.3 });
    }
    function resize() {
      const rect = wrap!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2; U = Math.min(W, H); Rr = (U / 2) * 0.84;
      if (ret.x === 0) { ret.x = cx; ret.y = cy; }
      buildStars();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function startGame() {
      enemies.length = 0; tracers.length = 0; parts.length = 0;
      score = 0; lives = 3; over = false; started = true; spawnEvery = 46; jetEx = 0;
      lastSpawn = tf; lastFire = tf; hudDirty = true;
    }
    startRef.current = startGame;

    // Nişangâh + ateş
    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      ret.x = e.clientX - rect.left; ret.y = e.clientY - rect.top;
    }
    function onDown(e: PointerEvent) {
      onMove(e);
      if (!started || over) return;
      if (tf - lastFire < 6) return;
      lastFire = tf;
      // nişangâha en yakın düşmanı vur (ekran uzayında)
      let bi = -1, bd = 1e9;
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        const d = Math.hypot(ret.x - en.sx, ret.y - en.sy);
        if (d < en.rad + U * 0.03 && d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) {
        const en = enemies[bi];
        tracers.push({ x1: jsx, y1: jsy, x2: en.sx, y2: en.sy, life: 0, hit: true });
        boom(en.sx, en.sy, "#ffb454", en.rad / 10 + 0.6);
        enemies.splice(bi, 1); score += 1; hudDirty = true;
      } else {
        tracers.push({ x1: jsx, y1: jsy, x2: ret.x, y2: ret.y, life: 0, hit: false });
      }
    }
    if (!isMini) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
    }

    function horizon() { return H * 0.4; }
    function proj(ex: number, ez: number) {
      const hy = horizon();
      const p = Math.max(0, Math.min(1.05, 1 - ez));
      const persp = Math.pow(Math.max(0, p), 1.35);
      return { sx: cx + ex * (W * 0.6) * (0.1 + persp), sy: hy + persp * (H - hy), sc: 0.14 + persp * 2.6, p };
    }
    function boom(sx: number, sy: number, col: string, scl: number) {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * 6.2832, sp = U * (0.004 + Math.random() * 0.012) * scl;
        parts.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 20 + Math.random() * 14, c: col });
      }
    }
    function drawJetRear(x: number, y: number, s: number, bank: number) {
      ctx!.save(); ctx!.translate(x, y); ctx!.rotate(bank * 0.22);
      const fl = 10 + Math.random() * 7;
      const flame = ctx!.createRadialGradient(0, 5 * s, 0, 0, 5 * s, fl * s);
      flame.addColorStop(0, "#bfe9ff"); flame.addColorStop(0.4, "#ff9a3c"); flame.addColorStop(1, "rgba(255,60,30,0)");
      ctx!.fillStyle = flame; ctx!.beginPath(); ctx!.arc(0, 5 * s, fl * s, 0, 6.2832); ctx!.fill();
      ctx!.fillStyle = "#8894a6";
      ctx!.beginPath();
      ctx!.moveTo(-4 * s, -3 * s); ctx!.lineTo(-22 * s, 2 * s); ctx!.lineTo(-21 * s, 5 * s);
      ctx!.lineTo(-4 * s, 3 * s); ctx!.lineTo(4 * s, 3 * s); ctx!.lineTo(21 * s, 5 * s);
      ctx!.lineTo(22 * s, 2 * s); ctx!.lineTo(4 * s, -3 * s); ctx!.closePath(); ctx!.fill();
      const body = ctx!.createLinearGradient(-5 * s, 0, 5 * s, 0);
      body.addColorStop(0, "#69748a"); body.addColorStop(0.5, "#c3cdda"); body.addColorStop(1, "#69748a");
      ctx!.fillStyle = body;
      ctx!.beginPath(); ctx!.moveTo(-4.5 * s, -8 * s); ctx!.lineTo(4.5 * s, -8 * s); ctx!.lineTo(5 * s, 5 * s); ctx!.lineTo(-5 * s, 5 * s); ctx!.closePath(); ctx!.fill();
      ctx!.fillStyle = "#2a3340"; ctx!.beginPath(); ctx!.ellipse(0, 5 * s, 3.4 * s, 2 * s, 0, 0, 6.2832); ctx!.fill();
      ctx!.fillStyle = "#97a3b5"; ctx!.beginPath(); ctx!.moveTo(0, -20 * s); ctx!.lineTo(-2.4 * s, -6 * s); ctx!.lineTo(2.4 * s, -6 * s); ctx!.closePath(); ctx!.fill();
      ctx!.fillStyle = "#7d8a9c";
      ctx!.beginPath(); ctx!.moveTo(-4 * s, -4 * s); ctx!.lineTo(-11 * s, -1 * s); ctx!.lineTo(-4 * s, 0); ctx!.closePath();
      ctx!.moveTo(4 * s, -4 * s); ctx!.lineTo(11 * s, -1 * s); ctx!.lineTo(4 * s, 0); ctx!.closePath(); ctx!.fill();
      ctx!.restore();
    }
    function drawEnemyCraft(x: number, y: number, s: number) {
      ctx!.save(); ctx!.translate(x, y);
      ctx!.fillStyle = "#8894a6";
      ctx!.beginPath();
      ctx!.moveTo(-3 * s, 0); ctx!.lineTo(-16 * s, -3 * s); ctx!.lineTo(-15 * s, -6 * s);
      ctx!.lineTo(-3 * s, -3 * s); ctx!.lineTo(3 * s, -3 * s); ctx!.lineTo(15 * s, -6 * s);
      ctx!.lineTo(16 * s, -3 * s); ctx!.lineTo(3 * s, 0); ctx!.closePath(); ctx!.fill();
      ctx!.fillStyle = "#b23a4e";
      ctx!.beginPath(); ctx!.moveTo(0, 13 * s); ctx!.lineTo(3.4 * s, -6 * s); ctx!.lineTo(-3.4 * s, -6 * s); ctx!.closePath(); ctx!.fill();
      ctx!.shadowColor = "#ff5c7a"; ctx!.shadowBlur = 5 * s;
      ctx!.fillStyle = "#ff5c7a"; ctx!.beginPath(); ctx!.arc(0, 8 * s, 1.8 * s, 0, 6.2832); ctx!.fill();
      ctx!.shadowBlur = 0; ctx!.restore();
    }

    function battle() {
      const hy = horizon();
      const sky = ctx!.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#0a1224"); sky.addColorStop(1, "#132038");
      ctx!.fillStyle = sky; ctx!.fillRect(0, 0, W, hy);
      const gnd = ctx!.createLinearGradient(0, hy, 0, H);
      gnd.addColorStop(0, "#0c1a20"); gnd.addColorStop(1, "#050d12");
      ctx!.fillStyle = gnd; ctx!.fillRect(0, hy, W, H - hy);
      ctx!.fillStyle = "#9fb4e0";
      for (const st of stars) {
        if (!reduced) st.y += st.v * 0.4; if (st.y > hy) st.y = 0;
        ctx!.globalAlpha = 0.3 + st.r * 0.22; ctx!.fillRect(st.x, st.y, st.r, st.r * 2);
      }
      ctx!.globalAlpha = 1;
      ctx!.strokeStyle = "rgba(79,216,255,.12)"; ctx!.lineWidth = 1;
      for (let i = -6; i <= 6; i++) { ctx!.beginPath(); ctx!.moveTo(cx, hy); ctx!.lineTo(cx + i * (W * 0.19), H); ctx!.stroke(); }
      const scroll = (tf * 0.01) % 1;
      for (let r = 0; r < 7; r++) {
        const fr = (r + scroll) / 7, yy = hy + fr * fr * (H - hy);
        ctx!.globalAlpha = 0.14 * (1 - fr) + 0.04;
        ctx!.beginPath(); ctx!.moveTo(0, yy); ctx!.lineTo(W, yy); ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      // uçak yatay konumu: nişangâha doğru hafif kayar (dönüş hissi)
      const exT = Math.max(-1, Math.min(1, (ret.x - cx) / (W * 0.5)));
      jetEx += (exT * 0.5 - jetEx) * 0.12;
      jsx = cx + jetEx * (W * 0.42); jsy = H * 0.84;
      const jetS = U * 0.05 / 8;

      if (started && !over) {
        if (tf - lastSpawn > spawnEvery) {
          enemies.push({ ex: (Math.random() * 2 - 1) * 0.85, ez: 1, speed: 0.004 + Math.random() * 0.004, wob: Math.random() * 6.28, sx: 0, sy: 0, rad: 0 });
          lastSpawn = tf; spawnEvery = 30 + Math.floor(Math.random() * 28);
        }
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (!reduced) { e.ez -= e.speed; e.ex += Math.sin((tf + e.wob * 20) / 60) * 0.002; }
          if (e.ez < -0.04) {
            enemies.splice(i, 1); lives -= 1; hudDirty = true;
            boom(cx + e.ex * (W * 0.5), H - 6, "#ff5c7a", 1);
            if (lives <= 0) { over = true; hudDirty = true; }
          }
        }
      }

      // düşmanları çiz (uzak→yakın) + ekran konumu sakla
      const esorted = [...enemies].sort((a, b) => b.ez - a.ez);
      for (const e of esorted) {
        const pr = proj(e.ex, e.ez);
        e.sx = pr.sx; e.sy = pr.sy; e.rad = 16 * pr.sc * 0.55;
        drawEnemyCraft(pr.sx, pr.sy, pr.sc * 0.55);
      }
      // izler (tracer)
      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i]; t.life++; if (t.life > 8) { tracers.splice(i, 1); continue; }
        const a = 1 - t.life / 8;
        ctx!.strokeStyle = t.hit ? `rgba(139,233,255,${a})` : `rgba(160,180,210,${a * 0.7})`;
        ctx!.lineWidth = t.hit ? 2.5 : 1.5; ctx!.shadowColor = "#4fd8ff"; ctx!.shadowBlur = t.hit ? 8 : 0;
        ctx!.beginPath(); ctx!.moveTo(t.x1, t.y1); ctx!.lineTo(t.x2, t.y2); ctx!.stroke(); ctx!.shadowBlur = 0;
      }
      // patlamalar
      for (let i = parts.length - 1; i >= 0; i--) {
        const pt = parts[i]; pt.life++; if (pt.life > pt.max) { parts.splice(i, 1); continue; }
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += U * 0.0003;
        ctx!.globalAlpha = 1 - pt.life / pt.max; ctx!.fillStyle = pt.c;
        ctx!.beginPath(); ctx!.arc(pt.x, pt.y, 2.4, 0, 6.2832); ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      // oyuncu F-16
      drawJetRear(jsx, jsy, jetS, exT);
      // nişangâh (oyun başladıysa)
      if (started && !over) {
        ctx!.strokeStyle = "rgba(139,233,255,.85)"; ctx!.lineWidth = 1.5;
        ctx!.beginPath(); ctx!.arc(ret.x, ret.y, 12, 0, 6.2832); ctx!.stroke();
        ctx!.beginPath();
        ctx!.moveTo(ret.x - 18, ret.y); ctx!.lineTo(ret.x - 5, ret.y);
        ctx!.moveTo(ret.x + 5, ret.y); ctx!.lineTo(ret.x + 18, ret.y);
        ctx!.moveTo(ret.x, ret.y - 18); ctx!.lineTo(ret.x, ret.y - 5);
        ctx!.moveTo(ret.x, ret.y + 5); ctx!.lineTo(ret.x, ret.y + 18);
        ctx!.stroke();
      }
    }

    function ring(r: number, a: number) {
      ctx!.beginPath(); ctx!.arc(cx, cy, r, 0, 6.2832);
      ctx!.strokeStyle = `rgba(52,211,153,${a})`; ctx!.lineWidth = 1.2; ctx!.stroke();
    }
    function radar() {
      ctx!.save(); ctx!.globalAlpha = isMini ? 1 : 0.42;
      const disc = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Rr);
      disc.addColorStop(0, "#0c1a16"); disc.addColorStop(1, "#070f0d");
      ctx!.beginPath(); ctx!.arc(cx, cy, Rr, 0, 6.2832); ctx!.fillStyle = disc; ctx!.fill();
      ctx!.restore();
      ring(Rr * 0.28, 0.7); ring(Rr * 0.5, 0.6); ring(Rr * 0.72, 0.5); ring(Rr, 0.45);
      ctx!.strokeStyle = "rgba(23,58,45,.7)"; ctx!.lineWidth = 1;
      ctx!.beginPath(); ctx!.moveTo(cx - Rr, cy); ctx!.lineTo(cx + Rr, cy); ctx!.moveTo(cx, cy - Rr); ctx!.lineTo(cx, cy + Rr); ctx!.stroke();
      for (let k = 0; k < 26; k++) {
        const a = sweep - k * 0.035, al = (1 - k / 26) * 0.13;
        ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.arc(cx, cy, Rr, a, a + 0.045); ctx!.closePath();
        ctx!.fillStyle = `rgba(52,211,153,${al})`; ctx!.fill();
      }
      ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(cx + Math.cos(sweep) * Rr, cy + Math.sin(sweep) * Rr);
      ctx!.strokeStyle = "rgba(110,231,183,.75)"; ctx!.lineWidth = 2; ctx!.stroke();
      if (!isMini) {
        ctx!.textAlign = "center";
        for (const ag of RADAR_POS) {
          const ax = cx + Math.cos(ag.ang) * ag.rr * Rr, ay = cy + Math.sin(ag.ang) * ag.rr * Rr;
          ctx!.beginPath(); ctx!.arc(ax, ay, 4, 0, 6.2832); ctx!.fillStyle = ag.c;
          ctx!.shadowColor = ag.c; ctx!.shadowBlur = 6; ctx!.fill(); ctx!.shadowBlur = 0;
        }
      }
      corePulse += 0.05;
      const pr = (isMini ? Math.max(6, Rr * 0.22) : 22) + Math.sin(corePulse) * (isMini ? 1 : 2);
      const halo = ctx!.createRadialGradient(cx, cy, 0, cx, cy, pr + 18);
      halo.addColorStop(0, "rgba(52,211,153,.45)"); halo.addColorStop(1, "rgba(52,211,153,0)");
      ctx!.beginPath(); ctx!.arc(cx, cy, pr + 18, 0, 6.2832); ctx!.fillStyle = halo; ctx!.fill();
      const core = ctx!.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, pr);
      core.addColorStop(0, "#a7f3d0"); core.addColorStop(0.6, "#34d399"); core.addColorStop(1, "#0f9d63");
      ctx!.beginPath(); ctx!.arc(cx, cy, pr, 0, 6.2832); ctx!.fillStyle = core; ctx!.fill();
      if (!isMini) {
        ctx!.fillStyle = "#05231a"; ctx!.font = "700 13px 'Space Grotesk', sans-serif";
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle"; ctx!.fillText("Nova", cx, cy + 1); ctx!.textBaseline = "alphabetic";
      }
    }

    let raf = 0, running = true;
    function frame() {
      if (!running) return;
      tf++;
      ctx!.clearRect(0, 0, W, H);
      if (isMini) { ctx!.fillStyle = "#060d0b"; ctx!.fillRect(0, 0, W, H); }
      else battle();
      radar();
      sweep += reduced ? 0.01 : 0.02; if (sweep > Math.PI) sweep -= Math.PI * 2;
      if (hudDirty) { hudDirty = false; setHud({ score, lives, started, over }); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVis() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      if (!isMini) { canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mini]);

  return (
    <div ref={wrapRef} className="absolute inset-0" style={{ zIndex: 1, pointerEvents: mini ? "none" : "auto" }}>
      <canvas ref={canvasRef} style={{ display: "block", touchAction: "none", cursor: mini ? "pointer" : hud.started && !hud.over ? "crosshair" : "default" }} />
      {!mini && (
        <>
          {/* skor + can (oyun sırasında) */}
          {hud.started && !hud.over && (
            <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-4 rounded-lg px-3 py-2"
              style={{ background: "rgba(10,17,32,.62)", border: "1px solid #26406e", backdropFilter: "blur(8px)" }}>
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 18, fontWeight: 700, color: "#e8eefb" }}>{hud.score}</span>
                <span style={{ fontFamily: "var(--font-plex), monospace", fontSize: 9, letterSpacing: ".14em", color: "#8a97b5" }}>SKOR</span>
              </div>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} style={{ fontSize: 12, opacity: i < hud.lives ? 1 : 0.22 }}>✈️</span>
                ))}
              </div>
            </div>
          )}

          {/* başlangıç / oyun bitti perdesi */}
          {(!hud.started || hud.over) && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 text-center"
              style={{ background: "radial-gradient(65% 65% at 50% 45%, rgba(6,10,20,.55), rgba(6,10,20,.9))" }}>
              {hud.over ? (
                <>
                  <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 32, fontWeight: 700, color: "#ff5c7a" }}>Vuruldun!</div>
                  <div style={{ fontFamily: "var(--font-plex), monospace", color: "#8be9ff", fontSize: 15 }}>Skor: {hud.score}</div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 30, fontWeight: 700, color: "#e8eefb" }}>
                    Nova <span style={{ color: "#8be9ff" }}>Hava Savaşı</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-plex), monospace", color: "#8a97b5", fontSize: 12.5, maxWidth: 340, lineHeight: 1.6 }}>
                    Fare imleci nişangâhtır — düşmanın üstüne getir ve TIKLA. ESC ile çık.
                  </div>
                </>
              )}
              <button
                onClick={() => startRef.current()}
                className="rounded-xl px-7 py-3 text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#8be9ff,#4fd8ff)", color: "#04141f", boxShadow: "0 0 26px rgba(79,216,255,.4)" }}
              >
                {hud.over ? "↻ Tekrar oyna" : "▶ Başla"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
