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
const MAX_OPEN = 30; // px (video uzayı) — tam açık ağız

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
    // Metin tabanlı hece zaman çizelgesi: harfler → ağız şekli + zaman.
    // Sesli harf açar (a geniş, e/i yana geniş, o/u yuvarlak); m/b/p dudakları
    // kapatır; s/ş/z/c/ç dişleri gösterir; f/v dar. Noktalama ve boşluklar
    // duraklama olarak zamanı uzatır. Heceler arasında vurgu farkı var.
    type Syl = { t: number; open: number; wide: number; kind: "v" | "c" | "close" };
    let timeline: Syl[] = [], tlStart = 0, tlDur = 0, tlSource: "neural" | "browser" = "browser";
    let charTime: number[] = []; // her karakterin çizelgedeki zamanı (ms) — boundary hizalama
    function onMouth(e: Event) {
      pulse = 1;
      const ci = (e as CustomEvent<{ charIndex?: number }>).detail?.charIndex ?? -1;
      // Tarayıcı kelime sınırı: gerçek ilerleyişle çizelgeyi hizala (kayma düzelt)
      if (ci >= 0 && ci < charTime.length && timeline.length) {
        const offset = (performance.now() - tlStart) - charTime[ci];
        if (Math.abs(offset) < 1500) tlStart += offset * 0.8;
      }
    }
    function onSpeak(e: Event) {
      const d = (e as CustomEvent<{ text?: string; durationMs?: number; source?: string }>).detail || {};
      const text = String(d.text || "");
      const src: "neural" | "browser" = d.source === "neural" ? "neural" : "browser";
      const lead = src === "neural" ? 60 : 160; // ilk sesten önceki gecikme (ms)
      // karakter ağırlıkları: harf 1, sesli 1.15, boşluk .55, virgül 3.5, nokta 7
      const weights: number[] = [];
      for (const raw of text) {
        const ch = raw.toLowerCase();
        if (/[aeıioöuü]/.test(ch)) weights.push(1.15);
        else if (/[a-zçğş]/.test(ch)) weights.push(0.95);
        else if (ch === " ") weights.push(0.55);
        else if (/[,;:]/.test(ch)) weights.push(3.5);
        else if (/[.!?…]/.test(ch)) weights.push(7);
        else weights.push(0.3);
      }
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const dur = Math.max(300, Number(d.durationMs) || total * 62 + lead);
      const scale = (dur - lead) / total;
      charTime = []; let cum = 0;
      const tl: Syl[] = [];
      let vi = 0;
      for (let i = 0; i < text.length; i++) {
        const t = lead + (cum + weights[i] * 0.5) * scale;
        charTime.push(lead + cum * scale);
        cum += weights[i];
        const ch = text[i].toLowerCase();
        if (/[aeıioöuü]/.test(ch)) {
          let open = 0.55, wide = 1;
          if (ch === "a") { open = 1; wide = 1.02; }
          else if (ch === "e") { open = 0.6; wide = 1.12; }
          else if (ch === "ı" || ch === "i") { open = 0.42; wide = 1.16; }
          else if (ch === "o" || ch === "ö") { open = 0.72; wide = 0.86; }
          else { open = 0.58; wide = 0.82; } // u/ü
          // vurgu: her hece aynı güçte değil (deterministik küçük çeşitleme)
          const r = (((Math.sin(vi * 12.9898 + i * 78.233) * 43758.5453) % 1) + 1) % 1; // 0..1
          const vary = 0.72 + 0.28 * r;
          vi++;
          tl.push({ t, open: open * vary, wide, kind: "v" });
        } else if (/[mbp]/.test(ch)) tl.push({ t, open: 0, wide: 1, kind: "close" });
        else if (/[fv]/.test(ch)) tl.push({ t, open: 0.12, wide: 1.06, kind: "c" });
        else if (/[sşzcçj]/.test(ch)) tl.push({ t, open: 0.2, wide: 1.12, kind: "c" });
        else if (/[tdnlrkgyh]/.test(ch)) tl.push({ t, open: 0.22, wide: 1, kind: "c" });
      }
      timeline = tl; tlStart = performance.now(); tlDur = dur; tlSource = src;
    }
    function onSpeakEnd() { timeline = []; charTime = []; }
    window.addEventListener("nova:audio", onAudio);
    window.addEventListener("nova:mouth", onMouth);
    window.addEventListener("nova:speak", onSpeak);
    window.addEventListener("nova:speakend", onSpeakEnd);
    function textMouth(now: number): { open: number; wide: number } | null {
      if (!timeline.length) return null;
      const t = now - tlStart;
      if (t > tlDur + 200) return { open: 0, wide: 1 };
      // sesli/sessiz gauss zarfları (±150 ms); m/b/p kapanışı çarpımsal
      let open = 0, ws = 0, wsum = 0, close = 0;
      for (const s of timeline) {
        const dt = t - s.t; if (dt < -160 || dt > 160) continue;
        if (s.kind === "close") { close = Math.max(close, Math.exp(-(dt * dt) / (2 * 34 * 34))); continue; }
        const sig = s.kind === "v" ? 58 : 40;
        const w = Math.exp(-(dt * dt) / (2 * sig * sig));
        open = Math.max(open, s.open * w); ws += s.wide * w; wsum += w;
      }
      return { open: open * (1 - close * 0.95), wide: wsum > 0 ? ws / wsum : 1 };
    }

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

    let open = 0, wide = 1; // ağız açıklığı 0..1 ve genişliği (yumuşatılmış)
    function mouthTarget(now: number): { open: number; wide: number } {
      if (voiceRef.current !== "speaking") return { open: 0, wide: 1 };
      const tm = textMouth(now);
      // Gerçek ses dalgası (OpenAI/fal TTS): şiddet → açıklık; şekil metinden
      if (analyser && tlSource === "neural" && timeline.length) {
        if (!td || td.length !== analyser.fftSize) td = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
        analyser.getByteTimeDomainData(td);
        let sum = 0;
        for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / td.length);
        const amp = Math.max(0, Math.min(1, (rms - 0.012) * 6.5));
        return { open: Math.max(amp, (tm?.open ?? 0) * 0.35 * Math.min(1, amp * 4)), wide: tm?.wide ?? 1 };
      }
      if (tm) return tm; // metin zaman çizelgesi (tarayıcı sesi)
      // hiçbir çizelge yok: kelime darbesi ya da hafif genel hece ritmi
      pulse *= 0.86;
      if (pulse > 0.08) return { open: Math.min(1, pulse * (0.7 + 0.3 * Math.sin(now / 38))), wide: 1 };
      const s = Math.sin(now / 95) * 0.5 + 0.5;
      return { open: 0.15 + s * 0.45, wide: 1 + (Math.sin(now / 210) * 0.08) };
    }

    function drawFace(d: number, wd: number) {
      fctx!.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
      fctx!.drawImage(video!, 0, 0, VW, VH);
      if (d < 0.5 && Math.abs(wd - 1) < 0.02) return;
      jctx.setTransform(1, 0, 0, 1, 0, 0);
      jctx.clearRect(0, 0, VW, VH);
      const x0 = M.cx - M.hw * 2.7, w = M.hw * 5.4;
      const lipH = M.bot - M.lip + 12; // alt dudak şeridi
      // 1) alt dudak şeridi: aşağı ESNER (köşeler yerinde kalır, ortası ağız içiyle
      //    örtülür) + sesli harfe göre yatay genişler/daralır
      const lipDestH = d + lipH * (1 - d / 120);
      jctx.save();
      jctx.translate(M.cx, 0); jctx.scale(wd, 1); jctx.translate(-M.cx, 0);
      jctx.drawImage(video!, x0, M.lip, w, lipH, x0, M.lip, w, lipDestH);
      jctx.restore();
      // 2) çene bandı: dudağın bittiği yerden başlar, aşağı kayar ve sıkışır;
      // 3) boyun bandı sıkışır (bantlar arasında boşluk kalmaz)
      const chinTop = M.lip + lipH, chinDestTop = M.lip + lipDestH, chinDestBot = M.chin + d * 0.45;
      jctx.drawImage(video!, x0, chinTop, w, M.chin - chinTop, x0, chinDestTop, w, chinDestBot - chinDestTop);
      jctx.drawImage(video!, x0, M.chin, w, M.neck - M.chin, x0, chinDestBot, w, M.neck - chinDestBot);
      // 3b) alt dudağın altına yumuşak gölge: çene açılınca derinlik hissi
      if (d > 3) {
        const sy = M.lip + lipDestH;
        const sh = jctx.createLinearGradient(0, sy - 2, 0, sy + 10 + d * 0.3);
        sh.addColorStop(0, `rgba(0,0,0,${Math.min(0.35, d / 60)})`); sh.addColorStop(1, "rgba(0,0,0,0)");
        jctx.fillStyle = sh; jctx.fillRect(M.cx - M.hw * 1.5, sy - 2, M.hw * 3, 12 + d * 0.3);
      }
      // 4) üst dudak hafif yukarı çekilir (dudak açılırken üst dudak da hareket eder)
      const up = d * 0.14;
      if (up > 0.3) jctx.drawImage(video!, M.cx - M.hw * 1.3, M.top - 4, M.hw * 2.6, M.lip - M.top + 4, M.cx - M.hw * 1.3, M.top - 4 - up, M.hw * 2.6, M.lip - M.top + 4);
      // kenarları yumuşat (dairesel maske)
      const my = (M.lip + M.chin) / 2 + d * 0.3;
      jctx.globalCompositeOperation = "destination-in";
      const g = jctx.createRadialGradient(M.cx, my, M.hw * 1.0, M.cx, my, M.hw * 2.7);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.68, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
      jctx.fillStyle = g; jctx.fillRect(0, 0, VW, VH);
      jctx.globalCompositeOperation = "source-over";
      // 5) ağız içi: üst dudak (kalkmış) ile kayan alt dudak arasındaki boşluk
      if (d > 0.5) {
        const topY = M.lip - up, h = d + up;
        jctx.save();
        jctx.beginPath(); jctx.ellipse(M.cx, topY + h / 2, M.hw * 0.98 * wd, h / 2 + 1.5, 0, 0, 6.2832); jctx.clip();
        const gi = jctx.createLinearGradient(0, topY, 0, topY + h);
        gi.addColorStop(0, "#160507"); gi.addColorStop(0.55, "#3a1216"); gi.addColorStop(1, "#5a2226");
        jctx.fillStyle = gi; jctx.fillRect(M.cx - M.hw * 1.2, topY - 2, M.hw * 2.4, h + 4);
        // dil ipucu (ağız iyice açıkken altta kırmızımsı yumuşak leke)
        if (h > 12) {
          jctx.fillStyle = "rgba(150,60,70,0.55)";
          jctx.beginPath(); jctx.ellipse(M.cx, topY + h * 0.95, M.hw * 0.5 * wd, h * 0.28, 0, 0, 6.2832); jctx.fill();
        }
        // üst dişler: açıklıkla belirir, hafif ayrımlı
        if (h > 5) {
          const th = Math.min(8, h * 0.4), tw = M.hw * 1.2 * wd;
          jctx.fillStyle = "rgba(238,229,218,0.94)";
          jctx.beginPath();
          if (typeof jctx.roundRect === "function") jctx.roundRect(M.cx - tw / 2, topY - 1, tw, th, [0, 0, 4, 4]);
          else jctx.rect(M.cx - tw / 2, topY - 1, tw, th);
          jctx.fill();
          jctx.strokeStyle = "rgba(120,100,95,0.35)"; jctx.lineWidth = 0.8;
          for (let k = -2; k <= 2; k++) { const x = M.cx + k * (tw / 5.2); jctx.beginPath(); jctx.moveTo(x, topY); jctx.lineTo(x, topY + th * 0.9); jctx.stroke(); }
        }
        jctx.restore();
      }
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
      if (t - last < 24) return; // ~40 fps (ağız geçişleri akıcı olsun)
      last = t;
      const target = mouthTarget(t);
      open += (target.open - open) * (target.open > open ? 0.5 : 0.32);
      wide += (target.wide - wide) * 0.3;
      if (video!.readyState >= 2) drawFace(open * MAX_OPEN, wide);
      drawRain(t);
      if (!reduced) {
        // 3B salınım + konuşurken hecelerle hafif baş kıpırtısı (nod)
        const ry = Math.sin(t * 0.00045) * 3.2, rx = Math.sin(t * 0.00032 + 1.3) * 1.8 + open * 0.9;
        tilt!.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg) translateY(${open * 1.6}px)`;
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
      window.removeEventListener("nova:speak", onSpeak); window.removeEventListener("nova:speakend", onSpeakEnd);
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
