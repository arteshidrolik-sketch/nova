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

    // --- arka plan uçak savaşı (3B perspektif) ---
    // ex: yatay dünya konumu (-1..1), ez: derinlik (1=ufuk/uzak, 0=kamera/yakın)
    type Enemy = { ex: number; ez: number; speed: number; wob: number };
    type Bullet = { ex: number; ez: number };
    type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string };
    type Star = { x: number; y: number; v: number; r: number };
    const jet = { x: 0, y: 0, ex: 0 }; // ex: oyuncunun yatay dünya konumu
    let tX = 0, tY = 0, hasPointer = false; // fare hedefi (oyuncu kontrolü)
    const bullets: Bullet[] = [];
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

    // Perspektif izdüşümü: (ex,ez) → ekran. ez 1=ufuk, 0=kamera.
    function horizon() { return H * 0.4; }
    function proj(ex: number, ez: number) {
      const hy = horizon();
      const p = Math.max(0, Math.min(1.05, 1 - ez)); // 0 uzak .. 1 yakın
      const persp = Math.pow(Math.max(0, p), 1.35);
      const sx = cx + ex * (W * 0.6) * (0.1 + persp);
      const sy = hy + persp * (H - hy);
      const sc = 0.14 + persp * 2.6;
      return { sx, sy, sc, p };
    }
    function boom(sx: number, sy: number, col: string, scl: number) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.2832, sp = U * (0.004 + Math.random() * 0.012) * scl;
        parts.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 20 + Math.random() * 14, c: col });
      }
    }
    // F-16 ARKADAN (kuyruk tarafı): dikey kuyruk, yanlara açılan kanatlar, parlayan egzoz.
    function drawJetRear(x: number, y: number, s: number, bank: number) {
      ctx!.save();
      ctx!.translate(x, y);
      ctx!.rotate(bank * 0.25); // dönüşte hafif yatış
      // egzoz alevi (art-yakıcı) — parlak
      const fl = 10 + Math.random() * 7;
      const flame = ctx!.createRadialGradient(0, 4 * s, 0, 0, 4 * s, fl * s);
      flame.addColorStop(0, "#bfe9ff"); flame.addColorStop(0.4, "#ff9a3c"); flame.addColorStop(1, "rgba(255,60,30,0)");
      ctx!.fillStyle = flame;
      ctx!.beginPath(); ctx!.arc(0, 5 * s, fl * s, 0, 6.2832); ctx!.fill();
      // ana kanatlar (arkadan geniş)
      ctx!.fillStyle = "#8894a6";
      ctx!.beginPath();
      ctx!.moveTo(-4 * s, -3 * s); ctx!.lineTo(-22 * s, 2 * s); ctx!.lineTo(-21 * s, 5 * s);
      ctx!.lineTo(-4 * s, 3 * s); ctx!.lineTo(4 * s, 3 * s); ctx!.lineTo(21 * s, 5 * s);
      ctx!.lineTo(22 * s, 2 * s); ctx!.lineTo(4 * s, -3 * s); ctx!.closePath(); ctx!.fill();
      // gövde (arkadan) — silindirik, üstte açık altta koyu
      const body = ctx!.createLinearGradient(-5 * s, 0, 5 * s, 0);
      body.addColorStop(0, "#69748a"); body.addColorStop(0.5, "#c3cdda"); body.addColorStop(1, "#69748a");
      ctx!.fillStyle = body;
      ctx!.beginPath();
      ctx!.moveTo(-4.5 * s, -8 * s); ctx!.lineTo(4.5 * s, -8 * s); ctx!.lineTo(5 * s, 5 * s);
      ctx!.lineTo(-5 * s, 5 * s); ctx!.closePath(); ctx!.fill();
      // egzoz halkası (nozzle)
      ctx!.fillStyle = "#2a3340";
      ctx!.beginPath(); ctx!.ellipse(0, 5 * s, 3.4 * s, 2 * s, 0, 0, 6.2832); ctx!.fill();
      // dikey kuyruk (arkadan yüksek üçgen)
      ctx!.fillStyle = "#97a3b5";
      ctx!.beginPath(); ctx!.moveTo(0, -20 * s); ctx!.lineTo(-2.4 * s, -6 * s); ctx!.lineTo(2.4 * s, -6 * s); ctx!.closePath(); ctx!.fill();
      // yatay kuyruk dengeleyiciler
      ctx!.fillStyle = "#7d8a9c";
      ctx!.beginPath();
      ctx!.moveTo(-4 * s, -4 * s); ctx!.lineTo(-11 * s, -1 * s); ctx!.lineTo(-4 * s, 0); ctx!.closePath();
      ctx!.moveTo(4 * s, -4 * s); ctx!.lineTo(11 * s, -1 * s); ctx!.lineTo(4 * s, 0); ctx!.closePath();
      ctx!.fill();
      ctx!.restore();
    }
    // Düşman uçağı — karşıdan geliyor (burun aşağı/izleyiciye dönük), uzakta küçük.
    function drawEnemyCraft(x: number, y: number, s: number) {
      ctx!.save();
      ctx!.translate(x, y);
      ctx!.fillStyle = "#8894a6";
      // kanatlar
      ctx!.beginPath();
      ctx!.moveTo(-3 * s, 0); ctx!.lineTo(-16 * s, -3 * s); ctx!.lineTo(-15 * s, -6 * s);
      ctx!.lineTo(-3 * s, -3 * s); ctx!.lineTo(3 * s, -3 * s); ctx!.lineTo(15 * s, -6 * s);
      ctx!.lineTo(16 * s, -3 * s); ctx!.lineTo(3 * s, 0); ctx!.closePath(); ctx!.fill();
      // gövde (burun izleyiciye doğru — aşağı)
      ctx!.fillStyle = "#b23a4e";
      ctx!.beginPath();
      ctx!.moveTo(0, 13 * s); ctx!.lineTo(3.4 * s, -6 * s); ctx!.lineTo(-3.4 * s, -6 * s); ctx!.closePath(); ctx!.fill();
      ctx!.shadowColor = "#ff5c7a"; ctx!.shadowBlur = 5 * s;
      ctx!.fillStyle = "#ff5c7a"; ctx!.beginPath(); ctx!.arc(0, 8 * s, 1.8 * s, 0, 6.2832); ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.restore();
    }

    function battle() {
      const hy = horizon();
      // gökyüzü (ufuk üstü)
      const sky = ctx!.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#0a1224"); sky.addColorStop(1, "#132038");
      ctx!.fillStyle = sky; ctx!.fillRect(0, 0, W, hy);
      // yer (ufuk altı)
      const gnd = ctx!.createLinearGradient(0, hy, 0, H);
      gnd.addColorStop(0, "#0c1a20"); gnd.addColorStop(1, "#050d12");
      ctx!.fillStyle = gnd; ctx!.fillRect(0, hy, W, H - hy);
      // yıldızlar (sadece gökyüzü)
      ctx!.fillStyle = "#9fb4e0";
      for (const st of stars) {
        if (!reduced) st.y += st.v * 0.4; if (st.y > hy) { st.y = 0; st.x = Math.random() * W; }
        ctx!.globalAlpha = 0.3 + st.r * 0.25; ctx!.fillRect(st.x, st.y % hy, st.r, st.r * 2);
      }
      ctx!.globalAlpha = 1;
      // derinlik ızgarası (kaçış noktasına yakınsayan çizgiler + akan enlemler)
      ctx!.strokeStyle = "rgba(79,216,255,.12)"; ctx!.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        ctx!.beginPath(); ctx!.moveTo(cx, hy); ctx!.lineTo(cx + i * (W * 0.19), H); ctx!.stroke();
      }
      const scroll = (tf * 0.010) % 1;
      for (let r = 0; r < 7; r++) {
        const fr = ((r + scroll) / 7);
        const yy = hy + fr * fr * (H - hy);
        ctx!.globalAlpha = 0.14 * (1 - fr) + 0.04;
        ctx!.beginPath(); ctx!.moveTo(0, yy); ctx!.lineTo(W, yy); ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      // OYUNCU: fare yatay konumu → jet.ex; hafif dikey serbestlik
      let bank = 0;
      if (hasPointer) {
        const exT = Math.max(-1, Math.min(1, (tX - cx) / (W * 0.42)));
        bank = exT - jet.ex;
        jet.ex += (exT - jet.ex) * 0.18;
      }
      const jetSX = cx + jet.ex * (W * 0.42);
      const jetSY = H * 0.82;
      const jetS = U * 0.05 / 8;

      // ateş: jet'in bulunduğu yatay hattan içeri (ez artar → ufka)
      if (tf - lastFire > 10) { bullets.push({ ex: jet.ex, ez: 0.04 }); lastFire = tf; }
      // spawn: ufuktan (ez=1), rastgele yatay
      if (tf - lastSpawn > spawnEvery) {
        enemies.push({ ex: (Math.random() * 2 - 1) * 0.85, ez: 1, speed: 0.005 + Math.random() * 0.005, wob: Math.random() * 6.28 });
        lastSpawn = tf; spawnEvery = 30 + Math.floor(Math.random() * 26);
      }

      // mermiler ilerlet
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; b.ez += 0.03; if (b.ez > 1.05) { bullets.splice(i, 1); }
      }
      // düşmanlar: yakına doğru (ez azalır) + çarpışma
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!reduced) { e.ez -= e.speed; e.ex += Math.sin((tf + e.wob * 20) / 60) * 0.002; }
        let hit = false;
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.ex - e.ex) < 0.14 && Math.abs(b.ez - e.ez) < 0.07) { bullets.splice(j, 1); hit = true; break; }
        }
        if (hit) { enemies.splice(i, 1); const pr = proj(e.ex, e.ez); boom(pr.sx, pr.sy, "#ffb454", pr.sc); continue; }
        if (e.ez < -0.05) { enemies.splice(i, 1); continue; }
      }

      // çizim: önce mermiler (uzak→yakın), sonra düşmanlar (uzak→yakın), sonra jet
      const bsorted = [...bullets].sort((a, b) => a.ez - b.ez);
      for (const b of bsorted) {
        const pr = proj(b.ex, b.ez);
        ctx!.globalAlpha = Math.min(1, pr.p + 0.2);
        ctx!.fillStyle = "#8be9ff"; ctx!.shadowColor = "#4fd8ff"; ctx!.shadowBlur = 6;
        const w = 2 + pr.sc * 1.2, h = 6 + pr.sc * 6;
        ctx!.fillRect(pr.sx - w / 2, pr.sy - h / 2, w, h);
        ctx!.shadowBlur = 0;
      }
      ctx!.globalAlpha = 1;
      const esorted = [...enemies].sort((a, b) => b.ez - a.ez);
      for (const e of esorted) {
        const pr = proj(e.ex, e.ez);
        drawEnemyCraft(pr.sx, pr.sy, pr.sc * 0.55);
      }
      // patlama parçacıkları
      for (let i = parts.length - 1; i >= 0; i--) {
        const pt = parts[i]; pt.life++; if (pt.life > pt.max) { parts.splice(i, 1); continue; }
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += U * 0.0003;
        ctx!.globalAlpha = 1 - pt.life / pt.max; ctx!.fillStyle = pt.c;
        ctx!.beginPath(); ctx!.arc(pt.x, pt.y, 2.4, 0, 6.2832); ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      // oyuncu F-16 (arkadan, ön planda)
      drawJetRear(jetSX, jetSY, jetS, bank);
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
