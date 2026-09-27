"use client";

import { useEffect, useRef, useState } from "react";

// MatrixFace — panodaki fotogerçekçi "Nova" yüzü, GERÇEK ağız görüntüleriyle
// dudak senkronu.
//
// Taban: public/avatar/nova-idle.mp4 (nefes alıp göz kırpan sakin döngü), her kare
// canvas'a çizilir. Konuşurken, aynı kadının konuşan videosundan kesilmiş gerçek
// ağız parçaları (public/avatar/lip-atlas.webp, 23 parça, harf sınıflarına göre:
// closed/rest/a/am/e/i/o/u) söylenen harfe göre seçilip boşta videosundaki baş
// kaymasına (lip.json → idleOff, kare başına) hizalanarak yumuşak kenarlı olarak
// üstüne konur; harfler arasında çapraz geçiş yapılır. Esnetme/çizim yok —
// ekranda her zaman gerçek fotoğrafik ağız vardır.
//
// Zamanlama: Chat her cümle başında "nova:speak" (metin + süre) yayınlar; tarayıcı
// sesinde kelime sınırı ("nova:mouth" charIndex) çizelgeyi gerçek konuşmaya hizalar;
// bulut sesinde Web Audio analizörü ("nova:audio") sessiz aralıklarda ağzı kapatır.

export type VoiceState = "idle" | "listening" | "speaking";
export const VOICE_EVENT = "nova:voice";

type Viseme = "closed" | "rest" | "a" | "am" | "e" | "i" | "o" | "u";
type LipMeta = {
  fps: number;
  video: { w: number; h: number };
  patch: { x0: number; y0: number; w: number; h: number };
  cols: number;
  patches: { k: number; label: Viseme }[];
  idleOff: [number, number][];
};
// Baş kıpırtısı için yaklaşık açıklık (minimal hareket: küçük değerler)
const OPEN: Record<Viseme, number> = { closed: 0, rest: 0.02, a: 0.06, am: 0.04, e: 0.04, i: 0.03, o: 0.04, u: 0.02 };
// MİNİMAL ağız seti (kullanıcı: "iki dudak arası çok açılıyor, minimal hareket daha
// gerçekçi"). Atlas parça numaraları (lip.json sırası): 0-1 kapalı, 2 hafif aralık,
// 3-4 diş ucu, 18-19 hafif aralık (dişsiz), 20 küçük diş, 21-22 büzük.
// Geniş açık "a" (5-10) ve tam dişli "e/i" (11-17) kareleri KULLANILMAZ.
const MINIMAL: Record<Viseme, number[]> = {
  closed: [0, 1],
  rest: [2, 19],
  a: [3, 4, 20],
  am: [2, 18],
  e: [2, 3, 19],
  i: [2, 18],
  o: [18, 19],
  u: [21, 22],
};
// Kullanıcı: "5 kat daha azalt, belli belirsiz hareket etsin" → 0.82 / 5 ≈ 0.16.
// Ağız parçası boşta ağzının üstüne yalnız %16 karışır: hareket sezilir ama belirgin değil.
const LAYER_MAX = 0.16;

function visemeOf(ch: string, vowelIdx: number): Viseme | null {
  if (ch === "a") return vowelIdx % 3 === 1 ? "am" : "a"; // vurgu çeşitlemesi
  if (ch === "e") return "e";
  if (ch === "ı" || ch === "i") return "i";
  if (ch === "o" || ch === "ö") return "o";
  if (ch === "u" || ch === "ü") return "u";
  if (/[mbp]/.test(ch)) return "closed";
  if (/[sşzcçj]/.test(ch)) return "i"; // dişler görünür, dudak gergin
  if (/[a-zğ]/.test(ch)) return "rest";
  return null;
}

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";

export default function MatrixFace() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceRef = useRef<HTMLCanvasElement | null>(null);
  const rainRef = useRef<HTMLCanvasElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<VoiceState>("idle");
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onVoice(e: Event) {
      const d = (e as CustomEvent<VoiceState>).detail;
      if (d === "idle" || d === "listening" || d === "speaking") { voiceRef.current = d; setVoice(d); }
    }
    window.addEventListener(VOICE_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_EVENT, onVoice);
  }, []);

  useEffect(() => {
    function onVis() { if (!document.hidden) videoRef.current?.play().catch(() => {}); }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const video = videoRef.current, face = faceRef.current, rain = rainRef.current, tilt = tiltRef.current;
    if (!video || !face || !rain || !tilt) return;
    const fctx = face.getContext("2d"), rctx = rain.getContext("2d");
    if (!fctx || !rctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let alive = true;

    // Ağız atlası + meta
    let meta: LipMeta | null = null;
    const atlas = new Image();
    let atlasOk = false;
    atlas.onload = () => { atlasOk = true; };
    atlas.src = "/avatar/lip-atlas.webp";
    let groups: Record<Viseme, number[]> | null = null;
    const byLabel = (m: LipMeta): Record<Viseme, number[]> => {
      // Minimal set; atlasta olmayan numara varsa etiket gruplarına düş
      const n = m.patches.length;
      const ok = Object.values(MINIMAL).every((l) => l.every((k) => k < n));
      if (ok) return MINIMAL;
      const out = { closed: [], rest: [], a: [], am: [], e: [], i: [], o: [], u: [] } as Record<Viseme, number[]>;
      for (const p of m.patches) out[p.label].push(p.k);
      return out;
    };
    fetch("/avatar/lip.json").then((r) => r.json()).then((m: LipMeta) => {
      if (alive) { meta = m; groups = byLabel(m); }
    }).catch(() => {});

    // Ses girdisi
    let analyser: AnalyserNode | null =
      (window as unknown as { __novaAnalyser?: AnalyserNode }).__novaAnalyser ?? null;
    let td: Uint8Array<ArrayBuffer> | null = null;
    function onAudio(e: Event) { analyser = (e as CustomEvent<AnalyserNode>).detail ?? null; td = null; }

    // Harf zaman çizelgesi: her giriş = bir harf sınıfı + zaman + seçilen parça
    type Cue = { t: number; v: Viseme; k: number };
    let cues: Cue[] = [], tlStart = 0, tlDur = 0, tlSource: "neural" | "browser" = "browser";
    let charTime: number[] = [];
    function onSpeak(e: Event) {
      const d = (e as CustomEvent<{ text?: string; durationMs?: number; source?: string }>).detail || {};
      const text = String(d.text || "");
      const src: "neural" | "browser" = d.source === "neural" ? "neural" : "browser";
      const lead = src === "neural" ? 60 : 160;
      const weights: number[] = [];
      for (const raw of text) {
        const ch = raw.toLocaleLowerCase("tr");
        if (/[aeıioöuü]/.test(ch)) weights.push(1.15);
        else if (/[a-zçğş]/.test(ch)) weights.push(0.95);
        else if (ch === " ") weights.push(0.55);
        else if (/[,;:]/.test(ch)) weights.push(3.5);
        else if (/[.!?…]/.test(ch)) weights.push(7);
        else weights.push(0.3);
      }
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const dur = Math.max(300, Number(d.durationMs) || text.length * 88 + lead);
      const scale = (dur - lead) / total;
      charTime = []; cues = [];
      // HECE düzeyi: ağız yalnız sesli harflerde (hecenin çekirdeği) ve dudak
      // kapanan sessizlerde (m/b/p) şekil değiştirir; diğer sessizler geçişte
      // kalır. İki şekil arası en az MIN_GAP ms — gerçek konuşmada ağız harf harf
      // değil hece hece hareket eder.
      const MIN_GAP = 150;
      let cum = 0, vi = 0, lastT = -1e9;
      for (let i = 0; i < text.length; i++) {
        const t = lead + (cum + weights[i] * 0.5) * scale;
        charTime.push(lead + cum * scale);
        cum += weights[i];
        const ch = text[i].toLocaleLowerCase("tr");
        const isVowel = /[aeıioöuü]/.test(ch);
        if (/[,;:.!?…]/.test(ch)) { cues.push({ t, v: "rest", k: -1 }); lastT = t; continue; } // duraklama
        if (ch === " ") continue;
        const v = visemeOf(ch, vi);
        if (isVowel) vi++;
        if (v === null) continue;
        const important = isVowel || v === "closed";
        if (!important) continue; // s/t/n/r… ayrı şekil almaz
        if (t - lastT < MIN_GAP) {
          // çok sık: öncekini bu heceyle değiştir (sesli, kapanmadan önceliklidir)
          const p = cues[cues.length - 1];
          if (p && p.v !== "rest" && isVowel && p.v === "closed") continue;
          if (p && p.v !== "rest" && isVowel) { p.v = v; const l = groups?.[v] ?? []; p.k = l.length ? l[(i * 7 + vi) % l.length] : -1; }
          continue;
        }
        const list = groups?.[v] ?? [];
        cues.push({ t, v, k: list.length ? list[(i * 7 + vi) % list.length] : -1 });
        lastT = t;
      }
      tlStart = performance.now(); tlDur = dur; tlSource = src;
    }
    function onSpeakEnd() { cues = []; charTime = []; }
    function onMouth(e: Event) {
      const ci = (e as CustomEvent<{ charIndex?: number }>).detail?.charIndex ?? -1;
      if (ci >= 0 && ci < charTime.length && cues.length) {
        const offset = (performance.now() - tlStart) - charTime[ci];
        if (Math.abs(offset) < 1500) tlStart += offset * 0.8;
      }
    }
    window.addEventListener("nova:audio", onAudio);
    window.addEventListener("nova:speak", onSpeak);
    window.addEventListener("nova:speakend", onSpeakEnd);
    window.addEventListener("nova:mouth", onMouth);

    // Şu anki ağız: iki parça + çapraz geçiş ağırlığı + katman görünürlüğü
    let layer = 0, openSm = 0, quiet = 0, fallbackI = 0, fallbackAt = 0;
    function amplitude(): number | null {
      if (!analyser || tlSource !== "neural") return null;
      if (!td || td.length !== analyser.fftSize) td = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
      analyser.getByteTimeDomainData(td);
      let s = 0;
      for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / td.length);
    }
    function current(now: number): { a: number; b: number; w: number; open: number; on: boolean } {
      const speaking = voiceRef.current === "speaking";
      if (!speaking || !groups) return { a: -1, b: -1, w: 0, open: 0, on: false };
      const valid = cues.filter((c) => c.k >= 0 || c.v === "rest");
      const t = now - tlStart;
      if (valid.length && t <= tlDur + 150) {
        let j = -1;
        for (let i = 0; i < valid.length; i++) if (valid[i].t <= t) j = i; else break;
        const pick = (c?: Cue) => (c && c.k >= 0 ? c.k : (groups!.rest[0] ?? -1));
        if (j < 0) return { a: pick(valid[0]), b: -1, w: 0, open: 0, on: t > -80 };
        const c0 = valid[j], c1 = valid[j + 1];
        const gap = c1 ? c1.t - c0.t : 999;
        // uzun duraklamada (virgül/nokta) ağız boşta haline döner
        if (gap > 380 && t - c0.t > 180) return { a: pick(c0), b: -1, w: 0, open: 0, on: false };
        const f = c1 ? Math.min(1, Math.max(0, (t - c0.t) / gap)) : 0;
        const w = f < 0.3 ? 0 : (f - 0.3) / 0.7; // aralığın büyük kısmında yumuşak geçiş
        const ww = w * w * (3 - 2 * w);
        return { a: pick(c0), b: c1 ? pick(c1) : -1, w: ww, open: OPEN[c0.v] * (1 - ww) + (c1 ? OPEN[c1.v] * ww : 0), on: true };
      }
      // çizelge yok: doğal görünen genel konuşma ritmi
      const seq: Viseme[] = ["a", "rest", "e", "o", "closed", "i", "am", "rest", "e", "u"];
      if (now - fallbackAt > 210) { fallbackAt = now; fallbackI = (fallbackI + 1) % seq.length; }
      const l1 = groups[seq[fallbackI]], l2 = groups[seq[(fallbackI + 1) % seq.length]];
      const w = Math.min(1, (now - fallbackAt) / 210);
      return { a: l1[fallbackI % l1.length] ?? -1, b: l2[fallbackI % l2.length] ?? -1, w: w * w, open: OPEN[seq[fallbackI]], on: true };
    }

    // Çerçeveleme: yüz (alın→çene, video y≈150-550) HER ZAMAN kartın içinde kalır.
    // Geniş kartta video yüksekliğe göre ölçeklenir; yanlardaki boşluk videonun
    // bulanık "kapla" kopyasıyla dolar, ön plan kenarları yumuşak geçişle birleşir.
    let W = 0, H = 0, dpr = 1, bs = 1, bx = 0, by = 0, scale = 1, ox = 0, oy = 0;
    const CELL = 14; let ncol = 0, rows = 0;
    let cols: { y: number; v: number; len: number }[] = [];
    const VW = 480, VH = 640, FACE_H = 420, FACE_CY = 335;
    const fg = document.createElement("canvas");
    const gctx = fg.getContext("2d")!;
    function resize() {
      const rect = face!.parentElement!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      for (const c of [face!, rain!, fg]) {
        c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
      }
      for (const c of [face!, rain!]) { c.style.width = W + "px"; c.style.height = H + "px"; }
      bs = Math.max(W / VW, H / VH); bx = (W - VW * bs) / 2; by = (H - VH * bs) * 0.3;
      scale = Math.min(bs, H / FACE_H);
      ox = (W - VW * scale) / 2;
      oy = Math.min(0, Math.max(H - VH * scale, H * 0.5 - FACE_CY * scale));
      ncol = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
      cols = Array.from({ length: ncol }, () => ({ y: Math.random() * rows, v: 0.05 + Math.random() * 0.12, len: 5 + Math.floor(Math.random() * 10) }));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(face.parentElement!);

    function drawPatch(k: number, alpha: number, dx: number, dy: number) {
      if (!meta || k < 0 || alpha <= 0.01) return;
      const P = meta.patch, sx = (k % meta.cols) * P.w, sy = Math.floor(k / meta.cols) * P.h;
      gctx.globalAlpha = alpha;
      gctx.drawImage(atlas, sx, sy, P.w, P.h, P.x0 + dx, P.y0 + dy, P.w, P.h);
      gctx.globalAlpha = 1;
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
      if (t - last < 24) return; // ~40 fps
      last = t;
      const cur = current(t);
      // bulut sesinde gerçek sessizlik: ağız boşta haline döner
      const amp = amplitude();
      if (amp !== null) quiet = amp < 0.02 ? quiet + 1 : 0;
      const on = cur.on && quiet < 5;
      layer += ((on ? LAYER_MAX : 0) - layer) * (on ? 0.35 : 0.22);
      openSm += (cur.open * (on ? 1 : 0) - openSm) * 0.3;
      if (video!.readyState >= 2) {
        const sideFill = VW * scale < W - 1;
        // 1) arka plan: bulanık "kapla" kopya (yalnız yanlarda boşluk varsa)
        fctx!.setTransform(1, 0, 0, 1, 0, 0);
        fctx!.clearRect(0, 0, face!.width, face!.height);
        if (sideFill) {
          fctx!.setTransform(dpr * bs, 0, 0, dpr * bs, bx * dpr, by * dpr);
          fctx!.filter = "blur(10px) brightness(0.55)";
          fctx!.drawImage(video!, 0, 0, VW, VH);
          fctx!.filter = "none";
        }
        // 2) ön plan: yüz sığacak ölçek + gerçek ağız parçaları
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.globalCompositeOperation = "source-over";
        gctx.clearRect(0, 0, fg.width, fg.height);
        gctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
        gctx.drawImage(video!, 0, 0, VW, VH);
        if (atlasOk && meta && layer > 0.01) {
          const n = meta.idleOff.length;
          const fi = Math.floor(video!.currentTime * meta.fps) % n;
          const [dx, dy] = meta.idleOff[fi] ?? [0, 0];
          drawPatch(cur.a, layer, dx, dy);
          drawPatch(cur.b, layer * cur.w, dx, dy); // sıradaki harfe çapraz geçiş
        }
        // 3) ön planın yan kenarlarını yumuşat → arka planla dikişsiz birleşsin
        if (sideFill) {
          gctx.setTransform(1, 0, 0, 1, 0, 0);
          gctx.globalCompositeOperation = "destination-in";
          const l = ox * dpr, r = (ox + VW * scale) * dpr, f = (r - l) * 0.16;
          const g = gctx.createLinearGradient(l, 0, r, 0);
          g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(f / (r - l), "rgba(0,0,0,1)");
          g.addColorStop(1 - f / (r - l), "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
          gctx.fillStyle = g; gctx.fillRect(0, 0, fg.width, fg.height);
          gctx.globalCompositeOperation = "source-over";
        }
        fctx!.setTransform(1, 0, 0, 1, 0, 0);
        fctx!.drawImage(fg, 0, 0);
      }
      drawRain(t);
      if (!reduced) {
        const ry = Math.sin(t * 0.00045) * 3.2, rx = Math.sin(t * 0.00032 + 1.3) * 1.8 + openSm * 0.7;
        tilt!.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg) translateY(${openSm * 1.2}px)`;
      }
    }
    raf = requestAnimationFrame(frame);
    function onVis() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false; running = false; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("nova:audio", onAudio); window.removeEventListener("nova:speak", onSpeak);
      window.removeEventListener("nova:speakend", onSpeakEnd); window.removeEventListener("nova:mouth", onMouth);
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/avatar/nova.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 22%", opacity: ready ? 0 : 1, transition: "opacity .8s ease" }} />
        <video ref={videoRef} src="/avatar/nova-idle.mp4" muted loop playsInline autoPlay preload="auto"
          onPlaying={() => setReady(true)}
          style={{ position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }} />
        <canvas ref={faceRef} style={{ position: "absolute", inset: 0, display: "block" }} />
        <canvas ref={rainRef} style={{ position: "absolute", inset: 0, display: "block", mixBlendMode: "screen", opacity: 0.7, pointerEvents: "none" }} />
        <div className="pointer-events-none absolute inset-0" style={{
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 1px, transparent 1px 3px), radial-gradient(80% 70% at 50% 40%, rgba(40,160,90,.08), rgba(2,12,6,.55) 100%)",
        }} />
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.16em]"
          style={{ color: speaking ? "#9dffb9" : listening ? "#8be9ff" : "rgba(180,240,200,.5)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "currentColor", boxShadow: "0 0 8px currentColor" }} />
          {speaking ? "Konuşuyor" : listening ? "Dinliyor" : "Nova"}
        </div>
      </div>
    </div>
  );
}
