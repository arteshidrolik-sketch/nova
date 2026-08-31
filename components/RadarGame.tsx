"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_META, AGENT_KEYS, type AgentActivity } from "@/lib/agents/meta";

export type VoiceState = "idle" | "listening" | "speaking";

type CustomAgent = { id: string; name: string; color: string };

// Ajanların radar üzerindeki sabit konumları (açı radyan, yarıçap oranı)
const RADAR_POS: Record<string, { ang: number; rr: number }> = {
  research: { ang: -2.5, rr: 0.82 },
  general: { ang: -1.15, rr: 0.6 },
  codeReviewer: { ang: -0.15, rr: 0.86 },
  releaseStore: { ang: 0.75, rr: 0.66 },
  projectOps: { ang: 1.7, rr: 0.83 },
  developer: { ang: 2.75, rr: 0.6 },
};

const BG_HUES = [158, 168, 150, 175, 45];

/**
 * RadarGame
 * ---------
 * Çalışma Alanı'nın üst bölgesi: fosfor-yeşil kontrol ekranı.
 * - Arka planda parallax ışıma + toz + radar yankıları (derinlik).
 * - Dönen tarama ışını radara düşen sinyalleri aydınlatır; tıkla/dokun → yakala.
 * - Merkezde Nova çekirdeği (ses durumuna tepki verir), halkalarda 6 ajan + özel ajanlar.
 * Tek canvas; oyun durumu ref'lerde (React yeniden-render'ı olmadan akıcı).
 */
export default function RadarGame({
  active,
  voice = "idle",
  customAgents = [],
  mini = false,
}: {
  active: AgentActivity;
  voice?: VoiceState;
  customAgents?: CustomAgent[];
  mini?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<AgentActivity>(active);
  const voiceRef = useRef<VoiceState>(voice);
  const customRef = useRef<CustomAgent[]>(customAgents);
  const [hud, setHud] = useState({ score: 0, combo: 0, caught: 0 });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    customRef.current = customAgents;
  }, [customAgents]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isMini = mini; // bu örnek için sabit (tam ekran vs köşe ayrı örnekler)

    let W = 0,
      H = 0,
      dpr = 1,
      cx = 0,
      cy = 0,
      Rr = 0;
    let mx = 0,
      my = 0,
      tmx = 0,
      tmy = 0;
    let sweep = -Math.PI / 2;
    let tf = 0,
      corePulse = 0;
    let lastSpawn = 0,
      spawnEvery = 1700,
      lastEcho = 0;

    type Sig = { ang: number; rr: number; state: "hidden" | "lit"; litAt: number };
    type Rip = { x: number; y: number; t: number; good: boolean; pts: number };
    const signals: Sig[] = [];
    const ripples: Rip[] = [];
    const blobs: {
      x: number; y: number; r: number; h: number; a: number;
      dx: number; dy: number; ph: number; ps: number; depth: number;
    }[] = [];
    const dust: { x: number; y: number; r: number; tw: number; twp: number; depth: number }[] = [];

    const score = { v: 0, combo: 0, caught: 0 };
    let hudDirty = false;

    function buildBg() {
      blobs.length = 0;
      dust.length = 0;
      for (let i = 0; i < 5; i++) {
        blobs.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.max(W, H) * (0.34 + Math.random() * 0.3),
          h: BG_HUES[i], a: 0.1 + Math.random() * 0.1,
          dx: (Math.random() - 0.5) * 0.05, dy: (Math.random() - 0.5) * 0.045,
          ph: Math.random() * 6.28, ps: 0.0005 + Math.random() * 0.0006,
          depth: 0.15 + Math.random() * 0.4,
        });
      }
      const n = Math.round((W * H) / 9000);
      for (let i = 0; i < n; i++) {
        const d = Math.random();
        dust.push({
          x: Math.random() * W, y: Math.random() * H,
          r: 0.4 + d * 1.5, tw: 1.5 + Math.random() * 4,
          twp: Math.random() * 6.28, depth: 0.06 + d * 0.9,
        });
      }
    }

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr);
      canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px";
      canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
      Rr = (Math.min(W, H) / 2) * 0.84;
      buildBg();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function onMove(e: MouseEvent) {
      tmx = e.clientX / window.innerWidth - 0.5;
      tmy = e.clientY / window.innerHeight - 0.5;
    }
    window.addEventListener("mousemove", onMove);

    const angDist = (a: number, b: number) => {
      let d = Math.abs(a - b) % (Math.PI * 2);
      return d > Math.PI ? Math.PI * 2 - d : d;
    };

    function spawn() {
      if (signals.length >= 9) return;
      signals.push({
        ang: Math.random() * Math.PI * 2,
        rr: 0.24 + Math.random() * 0.7,
        state: "hidden",
        litAt: 0,
      });
    }

    // sinyal yakala (aydınlanmış olana dokun)
    function onDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let bi = -1,
        bd = 1e9;
      for (let i = 0; i < signals.length; i++) {
        const s = signals[i];
        if (s.state !== "lit") continue;
        const sx = cx + Math.cos(s.ang) * s.rr * Rr;
        const sy = cy + Math.sin(s.ang) * s.rr * Rr;
        const d = Math.hypot(x - sx, y - sy);
        if (d < 28 && d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi >= 0) {
        const s = signals[bi];
        const sx = cx + Math.cos(s.ang) * s.rr * Rr;
        const sy = cy + Math.sin(s.ang) * s.rr * Rr;
        signals.splice(bi, 1);
        score.combo++;
        score.caught++;
        const pts = 10 + Math.min(score.combo - 1, 9) * 2;
        score.v += pts;
        ripples.push({ x: sx, y: sy, t: performance.now(), good: true, pts });
        hudDirty = true;
        e.stopPropagation();
      }
    }
    if (!isMini) canvas.addEventListener("pointerdown", onDown);

    function ring(r: number, alpha: number) {
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(28,81,64,${alpha})`;
      ctx!.lineWidth = 1.2;
      ctx!.stroke();
    }

    let raf = 0;
    let running = true;

    function frame(now: number) {
      if (!running) return;
      tf++;
      mx += (tmx - mx) * 0.04;
      my += (tmy - my) * 0.04;
      ctx!.clearRect(0, 0, W, H);

      // --- arka plan derinliği ---
      const base = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
      base.addColorStop(0, "#0a1512");
      base.addColorStop(1, "#05100c");
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = base;
      ctx!.fillRect(0, 0, W, H);

      ctx!.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        if (!reduced) {
          b.x += b.dx;
          b.y += b.dy;
          if (b.x < -b.r) b.x = W + b.r;
          if (b.x > W + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = H + b.r;
          if (b.y > H + b.r) b.y = -b.r;
        }
        const pulse = 0.78 + Math.sin(tf * b.ps * 60 + b.ph) * 0.22;
        const px = b.x + mx * 70 * b.depth;
        const py = b.y + my * 70 * b.depth;
        const rr = b.r * pulse;
        const rad = ctx!.createRadialGradient(px, py, 0, px, py, rr);
        rad.addColorStop(0, `hsla(${b.h},70%,52%,${b.a})`);
        rad.addColorStop(0.5, `hsla(${b.h},70%,50%,${b.a * 0.4})`);
        rad.addColorStop(1, `hsla(${b.h},70%,50%,0)`);
        ctx!.fillStyle = rad;
        ctx!.beginPath();
        ctx!.arc(px, py, rr, 0, 6.2832);
        ctx!.fill();
      }
      for (const d of dust) {
        const tw = reduced ? 0.6 : 0.5 + Math.sin(tf / (d.tw * 6) + d.twp) * 0.45;
        ctx!.globalAlpha = tw * 0.9;
        ctx!.fillStyle = d.depth > 0.7 ? "#a7f3d0" : "#3f7d64";
        ctx!.beginPath();
        ctx!.arc(d.x + mx * 95 * d.depth, d.y + my * 95 * d.depth, d.r, 0, 6.2832);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      if (!reduced && now - lastEcho > 3800) {
        ripples.push({ x: cx, y: cy, t: now, good: true, pts: -1 }); // -1 = echo
        lastEcho = now;
      }

      ctx!.globalCompositeOperation = "source-over";

      // --- radar diski ---
      const disc = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Rr);
      disc.addColorStop(0, "#0c1a16");
      disc.addColorStop(1, "#070f0d");
      ctx!.beginPath();
      ctx!.arc(cx, cy, Rr, 0, Math.PI * 2);
      ctx!.fillStyle = disc;
      ctx!.fill();

      ring(Rr * 0.28, 0.9);
      ring(Rr * 0.5, 0.8);
      ring(Rr * 0.72, 0.7);
      ring(Rr, 0.6);
      ctx!.strokeStyle = "rgba(23,58,45,.9)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.moveTo(cx - Rr, cy);
      ctx!.lineTo(cx + Rr, cy);
      ctx!.moveTo(cx, cy - Rr);
      ctx!.lineTo(cx, cy + Rr);
      ctx!.stroke();

      // tarama ışını (fosfor kuyruğu)
      for (let k = 0; k < 26; k++) {
        const a = sweep - k * 0.035;
        const alpha = (1 - k / 26) * 0.16;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.arc(cx, cy, Rr, a, a + 0.045);
        ctx!.closePath();
        ctx!.fillStyle = `rgba(52,211,153,${alpha})`;
        ctx!.fill();
      }
      ctx!.beginPath();
      ctx!.moveTo(cx, cy);
      ctx!.lineTo(cx + Math.cos(sweep) * Rr, cy + Math.sin(sweep) * Rr);
      ctx!.strokeStyle = "rgba(110,231,183,.9)";
      ctx!.lineWidth = 2;
      ctx!.stroke();

      // --- sinyaller ---
      for (let i = signals.length - 1; i >= 0; i--) {
        const s = signals[i];
        const sx = cx + Math.cos(s.ang) * s.rr * Rr;
        const sy = cy + Math.sin(s.ang) * s.rr * Rr;
        if (s.state === "hidden") {
          if (angDist(sweep, s.ang) < 0.05) {
            s.state = "lit";
            s.litAt = now;
          } else {
            ctx!.beginPath();
            ctx!.arc(sx, sy, 2, 0, 6.2832);
            ctx!.fillStyle = "rgba(47,109,85,.5)";
            ctx!.fill();
            continue;
          }
        }
        const age = now - s.litAt;
        if (age > 2500) {
          signals.splice(i, 1);
          score.combo = 0;
          ripples.push({ x: sx, y: sy, t: now, good: false, pts: 0 });
          hudDirty = true;
          continue;
        }
        const life = 1 - age / 2500;
        const pulse = 0.6 + Math.sin(now / 120) * 0.4;
        ctx!.beginPath();
        ctx!.arc(sx, sy, 9 + (1 - life) * 10, 0, 6.2832);
        ctx!.strokeStyle = `rgba(167,243,208,${0.5 * life})`;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(sx, sy, 5, 0, 6.2832);
        ctx!.fillStyle = `rgba(167,243,208,${0.55 + 0.45 * pulse})`;
        ctx!.shadowColor = "#a7f3d0";
        ctx!.shadowBlur = 14;
        ctx!.fill();
        ctx!.shadowBlur = 0;
        ctx!.beginPath();
        ctx!.arc(sx, sy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life);
        ctx!.strokeStyle = "rgba(251,191,36,.8)";
        ctx!.lineWidth = 2;
        ctx!.stroke();
      }

      // --- ripple / yankı ---
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = now - rp.t;
        if (rp.pts === -1) {
          // radar yankısı (dış alana açılır)
          const dur = 4200;
          if (age > dur) {
            ripples.splice(i, 1);
            continue;
          }
          const p = age / dur;
          ctx!.beginPath();
          ctx!.arc(cx, cy, p * Math.max(W, H) * 0.7, 0, 6.2832);
          ctx!.strokeStyle = `rgba(52,211,153,${(1 - p) * 0.1})`;
          ctx!.lineWidth = 1.4;
          ctx!.stroke();
          continue;
        }
        if (age > 520) {
          ripples.splice(i, 1);
          continue;
        }
        const p = age / 520;
        const col = rp.good ? "110,231,183" : "244,114,182";
        ctx!.beginPath();
        ctx!.arc(rp.x, rp.y, 6 + p * 28, 0, 6.2832);
        ctx!.strokeStyle = `rgba(${col},${(1 - p) * 0.9})`;
        ctx!.lineWidth = 2.5;
        ctx!.stroke();
        if (rp.good && rp.pts > 0) {
          ctx!.fillStyle = `rgba(${col},${1 - p})`;
          ctx!.font = "700 13px 'Space Grotesk', sans-serif";
          ctx!.textAlign = "center";
          ctx!.fillText("+" + rp.pts, rp.x, rp.y - 18 - p * 10);
        }
      }

      // --- ajan işaretleri (mini modda gizli) ---
      const act = activeRef.current;
      ctx!.textAlign = "center";
      if (!isMini) for (const key of AGENT_KEYS) {
        const pos = RADAR_POS[key];
        if (!pos) continue;
        const meta = AGENT_META[key];
        const on = act === key;
        const ax = cx + Math.cos(pos.ang) * pos.rr * Rr;
        const ay = cy + Math.sin(pos.ang) * pos.rr * Rr;
        if (on) {
          const rp = 8 + (Math.sin(now / 180) * 0.5 + 0.5) * 10;
          ctx!.beginPath();
          ctx!.arc(ax, ay, rp, 0, 6.2832);
          ctx!.strokeStyle = meta.color + "aa";
          ctx!.lineWidth = 2;
          ctx!.stroke();
        }
        ctx!.beginPath();
        ctx!.arc(ax, ay, on ? 6 : 4.5, 0, 6.2832);
        ctx!.fillStyle = meta.color;
        ctx!.shadowColor = meta.color;
        ctx!.shadowBlur = on ? 14 : 8;
        ctx!.fill();
        ctx!.shadowBlur = 0;
        ctx!.beginPath();
        ctx!.arc(ax, ay, on ? 10 : 8, 0, 6.2832);
        ctx!.strokeStyle = meta.color + (on ? "88" : "55");
        ctx!.lineWidth = 1;
        ctx!.stroke();
        ctx!.fillStyle = on ? meta.color : "rgba(190,233,210,.85)";
        ctx!.font = "10px 'IBM Plex Mono', monospace";
        const off = ay < cy ? -14 : 18;
        ctx!.fillText(meta.label.toLocaleUpperCase("tr"), ax, ay + off);
      }
      // özel ajanlar (dış halka)
      const cus = isMini ? [] : customRef.current;
      cus.forEach((a, i) => {
        const ang = -Math.PI / 2 + ((i + 0.5) / Math.max(1, cus.length)) * Math.PI * 2;
        const ax = cx + Math.cos(ang) * 0.94 * Rr;
        const ay = cy + Math.sin(ang) * 0.94 * Rr;
        ctx!.beginPath();
        ctx!.arc(ax, ay, 4, 0, 6.2832);
        ctx!.fillStyle = a.color;
        ctx!.shadowColor = a.color;
        ctx!.shadowBlur = 7;
        ctx!.fill();
        ctx!.shadowBlur = 0;
      });

      // --- Nova çekirdeği (ses tepkili) ---
      const vc = voiceRef.current;
      corePulse += 0.05;
      const baseCore = isMini ? Math.max(6, Rr * 0.22) : 26;
      const pr = baseCore + Math.sin(corePulse) * (isMini ? 1 : 2);
      const halo = ctx!.createRadialGradient(cx, cy, 0, cx, cy, pr + 22);
      halo.addColorStop(0, "rgba(52,211,153,.5)");
      halo.addColorStop(1, "rgba(52,211,153,0)");
      ctx!.beginPath();
      ctx!.arc(cx, cy, pr + 22, 0, 6.2832);
      ctx!.fillStyle = halo;
      ctx!.fill();
      // konuşurken genişleyen halkalar
      if (vc === "speaking") {
        const t2 = (now / 1600) % 1;
        ctx!.beginPath();
        ctx!.arc(cx, cy, pr + t2 * 70, 0, 6.2832);
        ctx!.strokeStyle = `rgba(110,231,183,${(1 - t2) * 0.8})`;
        ctx!.lineWidth = 2.5;
        ctx!.stroke();
      } else if (vc === "listening") {
        const t2 = Math.sin(now / 300) * 0.5 + 0.5;
        ctx!.beginPath();
        ctx!.arc(cx, cy, pr + 8 + t2 * 10, 0, 6.2832);
        ctx!.strokeStyle = `rgba(52,211,153,${0.3 + t2 * 0.4})`;
        ctx!.lineWidth = 2;
        ctx!.stroke();
      }
      const core = ctx!.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, pr);
      core.addColorStop(0, "#a7f3d0");
      core.addColorStop(0.6, "#34d399");
      core.addColorStop(1, "#0f9d63");
      ctx!.beginPath();
      ctx!.arc(cx, cy, pr, 0, 6.2832);
      ctx!.fillStyle = core;
      ctx!.fill();
      if (!isMini) {
        ctx!.fillStyle = "#05231a";
        ctx!.font = "700 15px 'Space Grotesk', sans-serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText("Nova", cx, cy + 1);
        ctx!.textBaseline = "alphabetic";
      }

      // spawn + zorluk (mini modda oyun yok)
      if (!isMini && now - lastSpawn > spawnEvery) {
        spawn();
        lastSpawn = now;
        spawnEvery = Math.max(820, 1700 - score.v * 2.5);
      }

      // HUD güncelle (seyrek)
      if (!isMini && hudDirty) {
        hudDirty = false;
        setHud({ score: score.v, combo: score.combo, caught: score.caught });
      }

      sweep += reduced ? 0.01 : 0.02;
      if (sweep > Math.PI) sweep -= Math.PI * 2;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVis() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        lastSpawn = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      style={{ zIndex: 1, pointerEvents: mini ? "none" : "auto" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          touchAction: "none",
          cursor: mini ? "pointer" : "crosshair",
        }}
      />
      {/* skor rozeti (mini modda gizli) */}
      {!mini && (
      <div
        className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-4 rounded-lg px-3 py-2"
        style={{
          background: "rgba(12,26,22,.62)",
          border: "1px solid #1c5140",
          backdropFilter: "blur(8px)",
          fontFamily: "var(--font-plex), 'IBM Plex Mono', monospace",
        }}
      >
        <div className="flex flex-col items-start leading-none">
          <span style={{ fontFamily: "var(--font-space), 'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: "#e6f3ec" }}>
            {hud.score}
          </span>
          <span style={{ fontSize: 9, letterSpacing: ".16em", color: "#5f8a72", marginTop: 3 }}>
            SKOR
          </span>
        </div>
        <div className="flex flex-col items-start leading-none">
          <span
            style={{
              fontFamily: "var(--font-space), 'Space Grotesk', sans-serif",
              fontSize: 18,
              fontWeight: 700,
              color: hud.combo >= 3 ? "#6ee7b7" : "#e6f3ec",
            }}
          >
            {hud.combo}
          </span>
          <span style={{ fontSize: 9, letterSpacing: ".16em", color: "#5f8a72", marginTop: 3 }}>
            SERİ
          </span>
        </div>
      </div>
      )}
    </div>
  );
}
