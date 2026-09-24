"use client";

import { useEffect, useRef, useState } from "react";

// MatrixFace — panodaki fotogerçekçi "Nova" yüzü, GERÇEK dudak senkronuyla.
// Kaynak: public/avatar/nova-idle.mp4 (nefes alıp göz kırpan sakin döngü). Her
// kare canvas'a çizilir; Nova konuşurken ağız bölgesi sesin gerçek şiddetine göre
// deforme edilir: alt dudak + çene aşağı kayar, arada ağız içi/dişler belirir.
// Ses kaynağı: Chat'in yayınladığı Web Audio analizörü ("nova:audio" olayı; OpenAI/
// fal TTS). Tarayıcı sesinde analizör olmadığından kelime sınırı darbeleri
// ("nova:mouth") kullanılır. Üstte hafif Matrix yağmuru + tarama çizgileri; kart
// 3B perspektifle salınır.

export type VoiceState = "idle" | "listening" | "speaking";
export const VOICE_EVENT = "nova:voice";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";
// Video (480x640) içindeki ağız/çene işaretleri (kare üzerinde ölçüldü)
const VW = 480, VH = 640;
const M = { cx: 241, top: 358, lip: 382, bot: 401, hw: 44, chin: 468, neck: 545 };
const MAX_OPEN = 26; // px (video uzayı) — tam açık ağız

export default function MatrixFace() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceRef = useRef<HTMLCanvasElement | null>(null);
  const rainRef = useRef<HTMLCanvasElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<VoiceState>("idle");
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [ready, setReady] = useState(false);

  // Ses durumu (Chat'ten global olay)
  useEffect(() => {
    function onVoice(e: Event) {
      const d = (e as CustomEvent<VoiceState>).detail;
      if (d === "idle" || d === "listening" || d === "speaking") { voiceRef.current = d; setVoice(d); }
    }
    window.addEventListener(VOICE_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_EVENT, onVoice);
  }, []);

  // Video oynatmayı sürdür (sekme görünür olunca tarayıcı durdurmuş olabilir)
  useEffect(() => {
    function onVis() { if (!document.hidden) videoRef.current?.play().catch(() => {}); }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Çizim döngüsü: yüz (video + ağız deformasyonu), yağmur, 3B salınım
  useEffect(() => {
    const video = videoRef.current, face = faceRef.current, rain = rainRef.current, tilt = tiltRef.current;
    if (!video || !face || !rain || !tilt) return;
    const fctx = face.getContext("2d"), rctx = rain.getContext("2d");
    if (!fctx || !rctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Ağız deformasyonu için video uzayında ara tuval
    const jaw = document.createElement("canvas"); jaw.width = VW; jaw.height = VH;
    const jctx = jaw.getContext("2d")!;

    // Ses girdisi: analizör (gerçek dalga) ya da kelime darbeleri
    let analyser: AnalyserNode | null =
      (window as unknown as { __novaAnalyser?: AnalyserNode }).__novaAnalyser ?? null;
    let td: Uint8Array<ArrayBuffer> | null = null;
    function onAudio(e: Event) { analyser = (e as CustomEvent<AnalyserNode>).detail ?? null; td = null; }
    let pulse = 0;
    function onMouth() { pulse = 1; }
    window.addEventListener("nova:audio", onAudio);
    window.addEventListener("nova:mouth", onMouth);

    let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
    const CELL = 14; let ncol = 0, rows = 0;
    let cols: { y: number; v: number; len: number }[] = [];
    function resize() {
      const rect = face!.parentElement!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      for (const c of [face!, rain!]) {
        c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
        c.style.width = W + "px"; c.style.height = H + "px";
      }
      // cover-fit: video kartı doldurur, odak %50 / %22 (yüz üstte kalsın)
      scale = Math.max(W / VW, H / VH);
      ox = (W - VW * scale) * 0.5; oy = (H - VH * scale) * 0.22;
      ncol = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
      cols = Array.from({ length: ncol }, () => ({ y: Math.random() * rows, v: 0.05 + Math.random() * 0.12, len: 5 + Math.floor(Math.random() * 10) }));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(face.parentElement!);

    let open = 0; // 0..1 ağız açıklığı (yumuşatılmış)
    function mouthTarget(): number {
      if (voiceRef.current !== "speaking") return 0;
      if (analyser) {
        if (!td || td.length !== analyser.fftSize) td = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
        analyser.getByteTimeDomainData(td);
        let sum = 0;
        for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / td.length);
        // konuşma RMS'i ~0.02-0.25 → 0..1 (sessiz aralıklarda ağız kapanır)
        return Math.max(0, Math.min(1, (rms - 0.012) * 6.5));
      }
      // tarayıcı sesi: kelime darbesi → sönümlenen hece hareketi
      pulse *= 0.86;
      return pulse > 0.08 ? Math.min(1, pulse * (0.7 + 0.3 * Math.sin(performance.now() / 38))) : 0;
    }

    function drawFace(d: number) {
      fctx!.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
      fctx!.drawImage(video!, 0, 0, VW, VH);
      if (d < 0.6) return;
      jctx.setTransform(1, 0, 0, 1, 0, 0);
      jctx.clearRect(0, 0, VW, VH);
      const x0 = M.cx - M.hw * 2.6, w = M.hw * 5.2;
      // alt dudak + çene bandı aşağı kayar (hafif sıkışarak); boyun bandı sıkışır
      jctx.drawImage(video!, x0, M.lip, w, M.chin - M.lip, x0, M.lip + d, w, (M.chin - M.lip) - d * 0.55);
      jctx.drawImage(video!, x0, M.chin, w, M.neck - M.chin, x0, M.chin + d * 0.45, w, (M.neck - M.chin) - d * 0.45);
      // kenarları yumuşat (dairesel maske)
      const my = (M.lip + M.chin) / 2 + d * 0.3;
      jctx.globalCompositeOperation = "destination-in";
      const g = jctx.createRadialGradient(M.cx, my, M.hw * 0.9, M.cx, my, M.hw * 2.6);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.7, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      jctx.fillStyle = g; jctx.fillRect(0, 0, VW, VH);
      jctx.globalCompositeOperation = "source-over";
      // ağız içi (üst dudak ile kayan alt dudak arasındaki boşluk) + dişler
      jctx.save();
      jctx.beginPath(); jctx.ellipse(M.cx, M.lip + d / 2, M.hw * 0.98, d / 2 + 1.5, 0, 0, 6.2832); jctx.clip();
      const gi = jctx.createLinearGradient(0, M.lip, 0, M.lip + d);
      gi.addColorStop(0, "#1c0709"); gi.addColorStop(1, "#4a1a1e");
      jctx.fillStyle = gi; jctx.fillRect(M.cx - M.hw, M.lip - 2, M.hw * 2, d + 4);
      if (d > 6) {
        jctx.fillStyle = "rgba(236,226,214,0.92)";
        const th = Math.min(7, d * 0.36);
        jctx.beginPath();
        if (typeof jctx.roundRect === "function") jctx.roundRect(M.cx - M.hw * 0.62, M.lip - 1, M.hw * 1.24, th, 3);
        else jctx.rect(M.cx - M.hw * 0.62, M.lip - 1, M.hw * 1.24, th);
        jctx.fill();
      }
      jctx.restore();
      fctx!.drawImage(jaw, 0, 0);
    }

    function drawRain(t: number) {
      rctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      rctx!.clearRect(0, 0, W, H);
      rctx!.font = `${CELL - 2}px 'Courier New', monospace`; rctx!.textBaseline = "top";
      for (let c = 0; c < ncol; c++) {
        const col = cols[c];
        if (!reduced) col.y += col.v;
        if (col.y - col.len > rows) { col.y = -Math.random() * rows; col.v = 0.05 + Math.random() * 0.12; }
        const head = Math.floor(col.y);
        for (let k = 0; k < col.len; k++) {
          const r = head - k; if (r < 0 || r >= rows) continue;
          const a = (1 - k / col.len) * 0.2;
          rctx!.fillStyle = k === 0 ? `rgba(200,255,215,${a + 0.14})` : `rgba(90,235,140,${a})`;
          rctx!.fillText(GLYPHS[(c * 31 + r * 7 + Math.floor(t / 400)) % GLYPHS.length], c * CELL, r * CELL);
        }
      }
    }

    let raf = 0, running = true, last = 0;
    function frame(t: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return; // ~30 fps
      last = t;
      const target = mouthTarget();
      open += (target - open) * (target > open ? 0.55 : 0.28);
      if (video!.readyState >= 2) drawFace(open * MAX_OPEN);
      drawRain(t);
      if (!reduced) {
        const ry = Math.sin(t * 0.00045) * 3.2, rx = Math.sin(t * 0.00032 + 1.3) * 1.8;
        tilt!.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg)`;
      }
    }
    raf = requestAnimationFrame(frame);
    function onVis() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("nova:audio", onAudio); window.removeEventListener("nova:mouth", onMouth);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const speaking = voice === "speaking", listening = voice === "listening";
  return (
    <div className="absolute inset-0" style={{ perspective: "900px" }}>
      <div
        ref={tiltRef}
        className="absolute inset-0 overflow-hidden rounded-2xl"
        style={{
          transformStyle: "preserve-3d", transition: "box-shadow .4s ease, scale .6s ease",
          scale: listening ? "1.03" : "1",
          boxShadow: speaking ? "inset 0 0 60px rgba(120,255,170,.25)" : listening ? "inset 0 0 60px rgba(79,216,255,.22)" : "inset 0 0 40px rgba(0,0,0,.5)",
        }}
      >
        {/* poster: video hazır olana kadar */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/avatar/nova.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 22%", opacity: ready ? 0 : 1, transition: "opacity .8s ease" }} />
        {/* kaynak video: görünmez, kareleri canvas'a çizilir */}
        <video ref={videoRef} src="/avatar/nova-idle.mp4" muted loop playsInline autoPlay preload="auto"
          onPlaying={() => setReady(true)}
          style={{ position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }} />
        <canvas ref={faceRef} style={{ position: "absolute", inset: 0, display: "block" }} />
        {/* Matrix yağmuru (ekran karışımı, hafif) */}
        <canvas ref={rainRef} style={{ position: "absolute", inset: 0, display: "block", mixBlendMode: "screen", opacity: 0.7, pointerEvents: "none" }} />
        {/* tarama çizgileri + yeşil ton + kenar kararması */}
        <div className="pointer-events-none absolute inset-0" style={{
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 1px, transparent 1px 3px), radial-gradient(80% 70% at 50% 40%, rgba(40,160,90,.08), rgba(2,12,6,.55) 100%)",
        }} />
        {/* durum ışığı */}
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.16em]"
          style={{ color: speaking ? "#9dffb9" : listening ? "#8be9ff" : "rgba(180,240,200,.5)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "currentColor", boxShadow: "0 0 8px currentColor" }} />
          {speaking ? "Konuşuyor" : listening ? "Dinliyor" : "Nova"}
        </div>
      </div>
    </div>
  );
}
