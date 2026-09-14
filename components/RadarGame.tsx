"use client";

import { useEffect, useRef, useState } from "react";
import { type AgentActivity } from "@/lib/agents/meta";

export type VoiceState = "idle" | "listening" | "speaking";

/**
 * RadarGame → Savaş uçağı oyunu
 * -----------------------------
 * Oyuncu uçağı (fareyle/dokunuşla yönlendirilir, otomatik ateş eder) yukarıdan
 * gelen düşmanlara ateş açar; vuruş = patlama + skor. Düşman alta ulaşırsa can
 * gider (3 can). mini modda küçük, sembolik, oynanmayan bir animasyon çalışır.
 * Aynı dosya/export adı korunur → Sidebar (mini) ve AppShell (tam ekran) aynen çalışır.
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
  const [hud, setHud] = useState({ score: 0, lives: 3, over: false });
  const restartRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isMini = mini;

    let W = 0, H = 0, dpr = 1, U = 100;
    type P = { x: number; y: number; vx: number; vy: number };
    type Enemy = P & { hp: number; wob: number };
    type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string };
    type Star = { x: number; y: number; v: number; r: number };

    const jet = { x: 0, y: 0 };
    let pointerX = -1;
    let usePointer = false;
    const bullets: P[] = [];
    const enemies: Enemy[] = [];
    const parts: Part[] = [];
    const stars: Star[] = [];
    let score = 0, lives = 3, over = false;
    let tf = 0, lastFire = 0, lastSpawn = 0, spawnEvery = 62;
    let hudDirty = false;

    function buildStars() {
      stars.length = 0;
      const n = Math.round((W * H) / 6000);
      for (let i = 0; i < n; i++) {
        stars.push({ x: Math.random() * W, y: Math.random() * H, v: 0.4 + Math.random() * 1.6, r: 0.4 + Math.random() * 1.4 });
      }
    }
    function resize() {
      const rect = wrap!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      U = Math.min(W, H);
      jet.x = W / 2; jet.y = H - U * 0.14;
      buildStars();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function onMove(e: PointerEvent) {
      if (isMini || over) return;
      const rect = canvas!.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      usePointer = true;
    }
    if (!isMini) canvas.addEventListener("pointermove", onMove);
    // dokunuşta da hareket
    if (!isMini) canvas.addEventListener("pointerdown", onMove);

    function reset() {
      bullets.length = 0; enemies.length = 0; parts.length = 0;
      score = 0; lives = 3; over = false; spawnEvery = 62;
      jet.x = W / 2; usePointer = false; pointerX = -1;
      hudDirty = true;
    }
    restartRef.current = reset;

    function boom(x: number, y: number, col: string) {
      const n = isMini ? 6 : 14;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.2832;
        const sp = U * (0.004 + Math.random() * 0.012);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 22 + Math.random() * 16, c: col });
      }
    }

    function drawJet(x: number, y: number, s: number) {
      ctx!.save();
      // gövde
      ctx!.fillStyle = "#8be9ff";
      ctx!.beginPath();
      ctx!.moveTo(x, y - 17 * s);
      ctx!.lineTo(x - 5 * s, y + 3 * s);
      ctx!.lineTo(x - 17 * s, y + 11 * s);
      ctx!.lineTo(x - 5 * s, y + 7 * s);
      ctx!.lineTo(x - 6 * s, y + 15 * s);
      ctx!.lineTo(x + 6 * s, y + 15 * s);
      ctx!.lineTo(x + 5 * s, y + 7 * s);
      ctx!.lineTo(x + 17 * s, y + 11 * s);
      ctx!.lineTo(x + 5 * s, y + 3 * s);
      ctx!.closePath();
      ctx!.shadowColor = "#4fd8ff"; ctx!.shadowBlur = 10 * s; ctx!.fill(); ctx!.shadowBlur = 0;
      // kokpit
      ctx!.fillStyle = "#06222e";
      ctx!.beginPath(); ctx!.arc(x, y - 5 * s, 3 * s, 0, 6.2832); ctx!.fill();
      // itki alevi
      const fl = 15 + Math.random() * 8;
      ctx!.fillStyle = "#ffb454";
      ctx!.beginPath();
      ctx!.moveTo(x - 3.5 * s, y + 15 * s);
      ctx!.lineTo(x, y + fl * s);
      ctx!.lineTo(x + 3.5 * s, y + 15 * s);
      ctx!.closePath(); ctx!.fill();
      ctx!.restore();
    }
    function drawEnemy(x: number, y: number, s: number) {
      ctx!.fillStyle = "#ff5c7a";
      ctx!.beginPath();
      ctx!.moveTo(x, y + 15 * s);
      ctx!.lineTo(x - 15 * s, y - 8 * s);
      ctx!.lineTo(x - 4 * s, y - 5 * s);
      ctx!.lineTo(x, y - 11 * s);
      ctx!.lineTo(x + 4 * s, y - 5 * s);
      ctx!.lineTo(x + 15 * s, y - 8 * s);
      ctx!.closePath();
      ctx!.shadowColor = "#ff5c7a"; ctx!.shadowBlur = 8 * s; ctx!.fill(); ctx!.shadowBlur = 0;
      ctx!.fillStyle = "#3a0a14";
      ctx!.beginPath(); ctx!.arc(x, y, 3 * s, 0, 6.2832); ctx!.fill();
    }

    let raf = 0, running = true;
    function frame() {
      if (!running) return;
      tf++;
      ctx!.clearRect(0, 0, W, H);
      // arka plan gökyüzü
      const bg = ctx!.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0a1120"); bg.addColorStop(1, "#060a14");
      ctx!.fillStyle = bg; ctx!.fillRect(0, 0, W, H);
      // yıldızlar (hız hissi — aşağı akar)
      ctx!.fillStyle = "#9fb4e0";
      for (const st of stars) {
        if (!reduced) st.y += st.v * (isMini ? 0.6 : 1.4);
        if (st.y > H) { st.y = 0; st.x = Math.random() * W; }
        ctx!.globalAlpha = 0.4 + st.r * 0.3;
        ctx!.fillRect(st.x, st.y, st.r, st.r * 2.4);
      }
      ctx!.globalAlpha = 1;

      const js = U * 0.05 / 8; // jet ölçeği
      const es = U * 0.05 / 8; // düşman ölçeği
      const bulletV = U * 0.02;
      const nowT = tf;

      // hedef x: fare yoksa/mini ise en yakın düşmanı hedefle (otomatik nişan)
      let targetX = jet.x;
      if (!over) {
        if (!isMini && usePointer && pointerX >= 0) targetX = pointerX;
        else {
          let near = -1, nd = 1e9;
          for (const e of enemies) { const d = Math.abs(e.x - jet.x); if (d < nd) { nd = d; near = e.x; } }
          targetX = near >= 0 ? near : W / 2;
        }
        jet.x += (targetX - jet.x) * 0.12;
        jet.x = Math.max(U * 0.06, Math.min(W - U * 0.06, jet.x));
      }

      // ateş
      if (!over && nowT - lastFire > (isMini ? 16 : 11)) {
        bullets.push({ x: jet.x, y: jet.y - 16 * js, vx: 0, vy: -bulletV });
        lastFire = nowT;
      }
      // spawn
      if (!over && nowT - lastSpawn > spawnEvery) {
        const ex = U * 0.08 + Math.random() * (W - U * 0.16);
        enemies.push({ x: ex, y: -U * 0.06, vx: (Math.random() - 0.5) * U * 0.002, vy: U * (0.0035 + Math.random() * 0.004), hp: 1, wob: Math.random() * 6.28 });
        lastSpawn = nowT;
        spawnEvery = Math.max(isMini ? 40 : 24, (isMini ? 70 : 62) - score * 0.5);
      }

      // mermiler
      ctx!.fillStyle = "#8be9ff";
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; b.y += b.vy;
        if (b.y < -10) { bullets.splice(i, 1); continue; }
        ctx!.shadowColor = "#4fd8ff"; ctx!.shadowBlur = 8;
        ctx!.fillRect(b.x - 1.5, b.y - 7, 3, 10); ctx!.shadowBlur = 0;
      }

      // düşmanlar + çarpışma
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!reduced) { e.y += e.vy; e.x += e.vx + Math.sin((nowT + e.wob * 20) / 40) * U * 0.0008; }
        // mermi çarpışması
        let hit = false;
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.x - e.x) < U * 0.045 && Math.abs(b.y - e.y) < U * 0.05) {
            bullets.splice(j, 1); hit = true; break;
          }
        }
        if (hit) {
          enemies.splice(i, 1); boom(e.x, e.y, "#ffb454");
          score += 1; hudDirty = true; continue;
        }
        if (e.y > H + U * 0.06) {
          enemies.splice(i, 1);
          if (!isMini) { lives -= 1; hudDirty = true; boom(e.x, H - 4, "#ff5c7a"); if (lives <= 0) { over = true; hudDirty = true; } }
          continue;
        }
        drawEnemy(e.x, e.y, es);
      }

      // patlama parçacıkları
      for (let i = parts.length - 1; i >= 0; i--) {
        const pt = parts[i]; pt.life++;
        if (pt.life > pt.max) { parts.splice(i, 1); continue; }
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += U * 0.0004;
        const a = 1 - pt.life / pt.max;
        ctx!.globalAlpha = a; ctx!.fillStyle = pt.c;
        ctx!.beginPath(); ctx!.arc(pt.x, pt.y, 2.2, 0, 6.2832); ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // uçak
      if (!over) drawJet(jet.x, jet.y, js);

      if (hudDirty) { hudDirty = false; setHud({ score, lives, over }); }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVis() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; lastSpawn = tf; lastFire = tf; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      if (!isMini) { canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onMove); }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mini]);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      style={{ zIndex: 1, pointerEvents: mini ? "none" : "auto" }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", touchAction: "none", cursor: mini ? "pointer" : "crosshair" }}
      />
      {!mini && (
        <>
          {/* skor + can */}
          <div
            className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-lg px-3 py-2"
            style={{ background: "rgba(10,17,32,.62)", border: "1px solid #26406e", backdropFilter: "blur(8px)" }}
          >
            <div className="flex items-center gap-3">
              <span style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 18, fontWeight: 700, color: "#e8eefb" }}>
                {hud.score}
              </span>
              <span style={{ fontFamily: "var(--font-plex), monospace", fontSize: 9, letterSpacing: ".16em", color: "#8a97b5" }}>
                SKOR
              </span>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <span key={i} style={{ fontSize: 13, opacity: i < hud.lives ? 1 : 0.22 }}>
                  ✈️
                </span>
              ))}
            </div>
          </div>

          {/* oyun bitti */}
          {hud.over && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4"
              style={{ background: "radial-gradient(60% 60% at 50% 45%, rgba(6,10,20,.55), rgba(6,10,20,.85))" }}>
              <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 34, fontWeight: 700, color: "#ff5c7a" }}>
                Vuruldun!
              </div>
              <div style={{ fontFamily: "var(--font-plex), monospace", color: "#8be9ff", fontSize: 15 }}>
                Skor: {hud.score}
              </div>
              <button
                onClick={() => restartRef.current()}
                className="rounded-xl px-6 py-3 text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#8be9ff,#4fd8ff)", color: "#04141f", boxShadow: "0 0 24px rgba(79,216,255,.4)" }}
              >
                ↻ Tekrar oyna
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
