"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// MatrixFace — panodaki boşluğu dolduran fotogerçekçi "Nova" yüzü.
// İki kısa video döngüsü (public/avatar): boşta nefes alıp göz kırpan, konuşan.
// Nova konuşurken (window "nova:voice" olayı → "speaking") konuşan döngüye
// yumuşak geçilir; dinlerken hafif yakınlaşma + yeşil ışık. Üstte hafif Matrix
// karakter yağmuru ve tarama çizgileri; kart 3B perspektifle hafifçe salınır.

export type VoiceState = "idle" | "listening" | "speaking";
export const VOICE_EVENT = "nova:voice";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";

export default function MatrixFace() {
  const idleRef = useRef<HTMLVideoElement | null>(null);
  const talkRef = useRef<HTMLVideoElement | null>(null);
  const rainRef = useRef<HTMLCanvasElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [ready, setReady] = useState(false);

  // Ses durumu (Chat'ten global olay)
  useEffect(() => {
    function onVoice(e: Event) {
      const d = (e as CustomEvent<VoiceState>).detail;
      if (d === "idle" || d === "listening" || d === "speaking") setVoice(d);
    }
    window.addEventListener(VOICE_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_EVENT, onVoice);
  }, []);

  // Videoları oynat/duraklat: görünen döngü oynar, diğeri (geçiş bitince) durur
  useEffect(() => {
    const idle = idleRef.current, talk = talkRef.current;
    if (!idle || !talk) return;
    const speaking = voice === "speaking";
    const show = speaking ? talk : idle, hide = speaking ? idle : talk;
    show.play().catch(() => {});
    const t = setTimeout(() => hide.pause(), 700); // crossfade süresi kadar bekle
    return () => clearTimeout(t);
  }, [voice]);

  // Sekme görünür olunca oynatmayı sürdür (tarayıcı arka planda durdurur)
  useEffect(() => {
    function onVis() {
      if (document.hidden) return;
      const v = voice === "speaking" ? talkRef.current : idleRef.current;
      v?.play().catch(() => {});
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [voice]);

  // Hafif Matrix yağmuru + 3B salınım (perspektif)
  useEffect(() => {
    const canvas = rainRef.current, tilt = tiltRef.current;
    if (!canvas || !tilt) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const CELL = 14;
    let W = 0, H = 0, ncol = 0, rows = 0;
    let cols: { y: number; v: number; len: number }[] = [];
    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ncol = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
      cols = Array.from({ length: ncol }, () => ({ y: Math.random() * rows, v: 0.05 + Math.random() * 0.12, len: 5 + Math.floor(Math.random() * 10) }));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    let raf = 0, running = true, last = 0;
    function frame(t: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 50) return; // 20 fps yeter (üst katman, hafif)
      last = t;
      ctx!.clearRect(0, 0, W, H);
      ctx!.font = `${CELL - 2}px 'Courier New', monospace`; ctx!.textBaseline = "top";
      for (let c = 0; c < ncol; c++) {
        const col = cols[c];
        if (!reduced) col.y += col.v;
        if (col.y - col.len > rows) { col.y = -Math.random() * rows; col.v = 0.05 + Math.random() * 0.12; }
        const head = Math.floor(col.y);
        for (let k = 0; k < col.len; k++) {
          const r = head - k; if (r < 0 || r >= rows) continue;
          const a = (1 - k / col.len) * 0.22;
          ctx!.fillStyle = k === 0 ? `rgba(200,255,215,${a + 0.15})` : `rgba(90,235,140,${a})`;
          ctx!.fillText(GLYPHS[(c * 31 + r * 7 + Math.floor(t / 400)) % GLYPHS.length], c * CELL, r * CELL);
        }
      }
      // 3B salınım: kart hafifçe döner (perspektif üst kapsayıcıda)
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
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const speaking = voice === "speaking", listening = voice === "listening";
  const vidStyle = (visible: boolean): CSSProperties => ({
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 22%",
    opacity: visible ? 1 : 0, transition: "opacity .6s ease",
  });

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
        {/* poster: videolar yüklenene kadar */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/avatar/nova.jpg" alt="" style={{ ...vidStyle(!ready), transition: "opacity .8s ease" }} />
        <video ref={idleRef} src="/avatar/nova-idle.mp4" poster="/avatar/nova.jpg" muted loop playsInline autoPlay preload="auto"
          onCanPlay={() => setReady(true)} style={vidStyle(ready && !speaking)} />
        <video ref={talkRef} src="/avatar/nova-talk.mp4" muted loop playsInline preload="auto" style={vidStyle(ready && speaking)} />
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
