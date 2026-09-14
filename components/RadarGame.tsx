"use client";

import { useEffect, useRef } from "react";
import { type AgentActivity } from "@/lib/agents/meta";

export type VoiceState = "idle" | "listening" | "speaking";

// Ajanların radar üzerindeki sabit konumları (açı radyan, yarıçap oranı)
const RADAR_POS: { name: string; ang: number; rr: number; c: string }[] = [
  { name: "ARAŞTIRMA", ang: -2.5, rr: 0.82, c: "#4fd8ff" },
  { name: "GENEL", ang: -1.15, rr: 0.6, c: "#c084fc" },
  { name: "KOD", ang: -0.15, rr: 0.86, c: "#f472b6" },
  { name: "SÜRÜM", ang: 0.75, rr: 0.66, c: "#fbbf24" },
  { name: "PROJE", ang: 1.7, rr: 0.83, c: "#34d399" },
  { name: "GELİŞTİRİCİ", ang: 2.75, rr: 0.6, c: "#60a5fa" },
];

/**
 * RadarGame
 * ---------
 * Fosfor-yeşil DAİRESEL RADAR görseli SABİT kalır (dönen tarama ışını, Nova
 * çekirdeği, ajanlar). ARKA PLANDA otomatik oynayan bir savaş uçağı savaşı
 * (uçak düşmanlara ateş açar, patlamalar) radarın altında/ardında görünür.
 * mini modda sadece küçük radar sembolü çalışır (uçak yok).
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

    // --- arka plan uçak savaşı (otomatik) ---
    type P = { x: number; y: number; vx: number; vy: number };
    type Enemy = P & { wob: number };
    type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string };
    type Star = { x: number; y: number; v: number; r: number };
    const jet = { x: 0, y: 0 };
    let tX = 0, tY = 0, hasPointer = false; // fare hedefi (oyuncu kontrolü)
    const bullets: P[] = [];
    const enemies: Enemy[] = [];
    const parts: Part[] = [];
    const stars: Star[] = [];
    let lastFire = 0, lastSpawn = 0, spawnEvery = 46;

    function buildStars() {
      stars.length = 0;
      const n = Math.round((W * H) / 6500);
      for (let i = 0; i < n; i++)
        stars.push({ x: Math.random() * W, y: Math.random() * H, v: 0.4 + Math.random() * 1.4, r: 0.4 + Math.random() * 1.3 });
    }
    function resize() {
      const rect = wrap!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2; U = Math.min(W, H); Rr = (U / 2) * 0.84;
      jet.x = W / 2; jet.y = H - U * 0.12;
      if (!hasPointer) { tX = jet.x; tY = jet.y; }
      buildStars();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Oyuncu kontrolü: uçak fareyi/dokunuşu takip eder (yalnız tam ekranda)
    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      tX = e.clientX - rect.left;
      tY = e.clientY - rect.top;
      hasPointer = true;
    }
    if (!isMini) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onMove);
    }

    function boom(x: number, y: number, col: string) {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * 6.2832, sp = U * (0.004 + Math.random() * 0.011);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 20 + Math.random() * 14, c: col });
      }
    }
    // Gerçekçi F-16 (yukarı bakan, tepeden görünüm) — gri gövde, delta kanat,
    // çift yatay dengeleyici, tek dikey kuyruk, kokpit ve hava alığı.
    function drawJet(x: number, y: number, s: number) {
      ctx!.save();
      ctx!.translate(x, y);
      // itki alevi (afterburner)
      const fl = 16 + Math.random() * 10;
      const flame = ctx!.createLinearGradient(0, 15 * s, 0, fl * s);
      flame.addColorStop(0, "#ffd27a"); flame.addColorStop(0.5, "#ff8a3c"); flame.addColorStop(1, "rgba(255,80,40,0)");
      ctx!.fillStyle = flame;
      ctx!.beginPath(); ctx!.moveTo(-3.2 * s, 15 * s); ctx!.lineTo(0, fl * s); ctx!.lineTo(3.2 * s, 15 * s); ctx!.closePath(); ctx!.fill();

      // ana kanatlar (delta, geriye ok)
      ctx!.fillStyle = "#9aa7b8";
      ctx!.beginPath();
      ctx!.moveTo(-2.5 * s, -2 * s); ctx!.lineTo(-20 * s, 8 * s); ctx!.lineTo(-19 * s, 11 * s);
      ctx!.lineTo(-2.5 * s, 6 * s); ctx!.lineTo(2.5 * s, 6 * s); ctx!.lineTo(19 * s, 11 * s);
      ctx!.lineTo(20 * s, 8 * s); ctx!.lineTo(2.5 * s, -2 * s); ctx!.closePath(); ctx!.fill();
      // kuyruk yatay dengeleyiciler
      ctx!.beginPath();
      ctx!.moveTo(-2 * s, 9 * s); ctx!.lineTo(-9 * s, 15 * s); ctx!.lineTo(-8 * s, 16.5 * s);
      ctx!.lineTo(-2 * s, 13 * s); ctx!.lineTo(2 * s, 13 * s); ctx!.lineTo(8 * s, 16.5 * s);
      ctx!.lineTo(9 * s, 15 * s); ctx!.lineTo(2 * s, 9 * s); ctx!.closePath(); ctx!.fill();

      // gövde (fuzelaj) — açık gri, uzun sivri burun
      const body = ctx!.createLinearGradient(-3 * s, 0, 3 * s, 0);
      body.addColorStop(0, "#7f8b9c"); body.addColorStop(0.5, "#cdd6e2"); body.addColorStop(1, "#7f8b9c");
      ctx!.fillStyle = body;
      ctx!.beginPath();
      ctx!.moveTo(0, -20 * s);
      ctx!.lineTo(2.2 * s, -8 * s); ctx!.lineTo(2.8 * s, 8 * s); ctx!.lineTo(2 * s, 15 * s);
      ctx!.lineTo(-2 * s, 15 * s); ctx!.lineTo(-2.8 * s, 8 * s); ctx!.lineTo(-2.2 * s, -8 * s);
      ctx!.closePath(); ctx!.fill();
      // dikey kuyruk
      ctx!.fillStyle = "#8592a4";
      ctx!.beginPath(); ctx!.moveTo(0, 6 * s); ctx!.lineTo(-1.4 * s, 15 * s); ctx!.lineTo(1.4 * s, 15 * s); ctx!.closePath(); ctx!.fill();
      // kokpit camı
      ctx!.fillStyle = "#1e3a5f";
      ctx!.beginPath(); ctx!.ellipse(0, -9 * s, 1.8 * s, 3.5 * s, 0, 0, 6.2832); ctx!.fill();
      ctx!.restore();
    }
    function drawEnemy(x: number, y: number, s: number) {
      ctx!.fillStyle = "#ff5c7a";
      ctx!.beginPath();
      ctx!.moveTo(x, y + 15 * s); ctx!.lineTo(x - 15 * s, y - 8 * s); ctx!.lineTo(x - 4 * s, y - 5 * s);
      ctx!.lineTo(x, y - 11 * s); ctx!.lineTo(x + 4 * s, y - 5 * s); ctx!.lineTo(x + 15 * s, y - 8 * s);
      ctx!.closePath();
      ctx!.shadowColor = "#ff5c7a"; ctx!.shadowBlur = 6 * s; ctx!.fill(); ctx!.shadowBlur = 0;
      ctx!.fillStyle = "#3a0a14"; ctx!.beginPath(); ctx!.arc(x, y, 3 * s, 0, 6.2832); ctx!.fill();
    }

    function battle() {
      // gökyüzü + akan yıldızlar
      const bg = ctx!.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0a1120"); bg.addColorStop(1, "#060a12");
      ctx!.fillStyle = bg; ctx!.fillRect(0, 0, W, H);
      ctx!.fillStyle = "#9fb4e0";
      for (const st of stars) {
        if (!reduced) st.y += st.v; if (st.y > H) { st.y = 0; st.x = Math.random() * W; }
        ctx!.globalAlpha = 0.35 + st.r * 0.28; ctx!.fillRect(st.x, st.y, st.r, st.r * 2.4);
      }
      ctx!.globalAlpha = 1;

      const js = U * 0.055 / 8, es = U * 0.025 / 8, bv = U * 0.02;
      // OYUNCU kontrolü: uçak fareyi takip eder (2B). Fare yoksa yerinde durur.
      if (hasPointer) { jet.x += (tX - jet.x) * 0.2; jet.y += (tY - jet.y) * 0.2; }
      jet.x = Math.max(U * 0.06, Math.min(W - U * 0.06, jet.x));
      jet.y = Math.max(U * 0.08, Math.min(H - U * 0.06, jet.y));

      if (tf - lastFire > 12) { bullets.push({ x: jet.x, y: jet.y - 16 * js, vx: 0, vy: -bv }); lastFire = tf; }
      if (tf - lastSpawn > spawnEvery) {
        enemies.push({ x: U * 0.08 + Math.random() * (W - U * 0.16), y: -U * 0.06, vx: (Math.random() - 0.5) * U * 0.002, vy: U * (0.003 + Math.random() * 0.003), wob: Math.random() * 6.28 });
        lastSpawn = tf; spawnEvery = 34 + Math.floor(Math.random() * 26);
      }

      ctx!.fillStyle = "#8be9ff";
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; b.y += b.vy; if (b.y < -10) { bullets.splice(i, 1); continue; }
        ctx!.shadowColor = "#4fd8ff"; ctx!.shadowBlur = 6; ctx!.fillRect(b.x - 1.5, b.y - 7, 3, 10); ctx!.shadowBlur = 0;
      }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!reduced) { e.y += e.vy; e.x += e.vx + Math.sin((tf + e.wob * 20) / 40) * U * 0.0008; }
        let hit = false;
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.x - e.x) < U * 0.03 && Math.abs(b.y - e.y) < U * 0.035) { bullets.splice(j, 1); hit = true; break; }
        }
        if (hit) { enemies.splice(i, 1); boom(e.x, e.y, "#ffb454"); continue; }
        if (e.y > H + U * 0.06) { enemies.splice(i, 1); continue; }
        drawEnemy(e.x, e.y, es);
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const pt = parts[i]; pt.life++; if (pt.life > pt.max) { parts.splice(i, 1); continue; }
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += U * 0.0004;
        ctx!.globalAlpha = 1 - pt.life / pt.max; ctx!.fillStyle = pt.c;
        ctx!.beginPath(); ctx!.arc(pt.x, pt.y, 2.2, 0, 6.2832); ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      drawJet(jet.x, jet.y, js);
    }

    function ring(r: number, a: number) {
      ctx!.beginPath(); ctx!.arc(cx, cy, r, 0, 6.2832);
      ctx!.strokeStyle = `rgba(52,211,153,${a})`; ctx!.lineWidth = 1.2; ctx!.stroke();
    }
    function radar() {
      // disk — YARI SAYDAM: arka plandaki savaş radardan görünsün, radar da net kalsın
      ctx!.save();
      ctx!.globalAlpha = isMini ? 1 : 0.5;
      const disc = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Rr);
      disc.addColorStop(0, "#0c1a16"); disc.addColorStop(1, "#070f0d");
      ctx!.beginPath(); ctx!.arc(cx, cy, Rr, 0, 6.2832); ctx!.fillStyle = disc; ctx!.fill();
      ctx!.restore();

      ring(Rr * 0.28, 0.85); ring(Rr * 0.5, 0.75); ring(Rr * 0.72, 0.65); ring(Rr, 0.55);
      ctx!.strokeStyle = "rgba(23,58,45,.85)"; ctx!.lineWidth = 1;
      ctx!.beginPath(); ctx!.moveTo(cx - Rr, cy); ctx!.lineTo(cx + Rr, cy); ctx!.moveTo(cx, cy - Rr); ctx!.lineTo(cx, cy + Rr); ctx!.stroke();

      // tarama ışını (fosfor kuyruğu) — dairesel görselin sabit imzası
      for (let k = 0; k < 26; k++) {
        const a = sweep - k * 0.035, al = (1 - k / 26) * 0.16;
        ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.arc(cx, cy, Rr, a, a + 0.045); ctx!.closePath();
        ctx!.fillStyle = `rgba(52,211,153,${al})`; ctx!.fill();
      }
      ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(cx + Math.cos(sweep) * Rr, cy + Math.sin(sweep) * Rr);
      ctx!.strokeStyle = "rgba(110,231,183,.9)"; ctx!.lineWidth = 2; ctx!.stroke();

      // ajanlar
      if (!isMini) {
        ctx!.textAlign = "center";
        for (const ag of RADAR_POS) {
          const ax = cx + Math.cos(ag.ang) * ag.rr * Rr, ay = cy + Math.sin(ag.ang) * ag.rr * Rr;
          ctx!.beginPath(); ctx!.arc(ax, ay, 4.5, 0, 6.2832); ctx!.fillStyle = ag.c;
          ctx!.shadowColor = ag.c; ctx!.shadowBlur = 8; ctx!.fill(); ctx!.shadowBlur = 0;
          ctx!.beginPath(); ctx!.arc(ax, ay, 8, 0, 6.2832); ctx!.strokeStyle = ag.c + "55"; ctx!.lineWidth = 1; ctx!.stroke();
          ctx!.fillStyle = "rgba(190,233,210,.85)"; ctx!.font = "10px 'IBM Plex Mono', monospace";
          ctx!.fillText(ag.name, ax, ay + (ay < cy ? -14 : 18));
        }
      }

      // merkez Nova çekirdeği
      corePulse += 0.05;
      const pr = (isMini ? Math.max(6, Rr * 0.22) : 26) + Math.sin(corePulse) * (isMini ? 1 : 2);
      const halo = ctx!.createRadialGradient(cx, cy, 0, cx, cy, pr + 22);
      halo.addColorStop(0, "rgba(52,211,153,.55)"); halo.addColorStop(1, "rgba(52,211,153,0)");
      ctx!.beginPath(); ctx!.arc(cx, cy, pr + 22, 0, 6.2832); ctx!.fillStyle = halo; ctx!.fill();
      const core = ctx!.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, pr);
      core.addColorStop(0, "#a7f3d0"); core.addColorStop(0.6, "#34d399"); core.addColorStop(1, "#0f9d63");
      ctx!.beginPath(); ctx!.arc(cx, cy, pr, 0, 6.2832); ctx!.fillStyle = core; ctx!.fill();
      if (!isMini) {
        ctx!.fillStyle = "#05231a"; ctx!.font = "700 15px 'Space Grotesk', sans-serif";
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillText("Nova", cx, cy + 1); ctx!.textBaseline = "alphabetic";
      }
    }

    let raf = 0, running = true;
    function frame() {
      if (!running) return;
      tf++;
      ctx!.clearRect(0, 0, W, H);
      if (isMini) {
        // mini: sadece radar (koyu zemin + radar)
        ctx!.fillStyle = "#060d0b"; ctx!.fillRect(0, 0, W, H);
      } else {
        battle(); // arka plan savaşı
      }
      radar(); // dairesel radar üstte (tam ekranda yarı saydam → savaş görünür)
      sweep += reduced ? 0.01 : 0.02; if (sweep > Math.PI) sweep -= Math.PI * 2;
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
    </div>
  );
}
