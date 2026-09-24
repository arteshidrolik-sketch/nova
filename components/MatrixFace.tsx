"use client";

import { useEffect, useRef } from "react";

// MatrixFace — panodaki boşluğu dolduran "Matrix" tarzı kadın yüzü silueti.
// Yüz, akan yeşil karakter yağmurunun içinde parlayan bir maske olarak belirir;
// üstüne ince ışıklı hatlarla göz, kaş, burun ve dudaklar çizilir.
// Nova konuşurken (window "nova:voice" olayı → "speaking") dudaklar hece ritmiyle
// açılıp kapanır; boşta göz kırpar, bakışını kaydırır, kaşını kaldırır, başını
// hafifçe eğer — sürekli küçük, rastgele mimikler.

export type VoiceState = "idle" | "listening" | "speaking";
export const VOICE_EVENT = "nova:voice";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ｦ";

export default function MatrixFace() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, dpr = 1;
    const CELL = 13; // karakter hücresi (px)
    type Col = { y: number; v: number; len: number };
    let cols: Col[] = [];
    let glyphs: string[] = []; // hücre başına karakter (ara sıra değişir)
    let rows = 0, ncol = 0;

    // Mimik durumu (0..1 aralıkları); hedefe doğru yumuşak geçiş
    const st = {
      blink: 0, browLift: 0, browT: 0, tilt: 0, tiltT: 0,
      gazeX: 0, gazeY: 0, gazeXT: 0, gazeYT: 0,
      smile: 0.35, smileT: 0.35, mouth: 0, mouthT: 0, wide: 0,
    };
    let voice: VoiceState = "idle";
    let nextBlink = 0, blinkStart = -1, nextMicro = 0, nextSyl = 0;

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr);
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ncol = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
      cols = Array.from({ length: ncol }, () => ({
        y: Math.random() * rows, v: 0.08 + Math.random() * 0.18, len: 6 + Math.floor(Math.random() * 12),
      }));
      glyphs = Array.from({ length: ncol * rows }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function onVoice(e: Event) {
      const d = (e as CustomEvent<VoiceState>).detail;
      if (d === "idle" || d === "listening" || d === "speaking") voice = d;
    }
    window.addEventListener(VOICE_EVENT, onVoice);

    // Yüz geometrisi — baş merkezi ve yarıçaplar (kart boyutuna göre)
    function geom() {
      const U = Math.min(W, H * 0.78);
      const rx = U * 0.24, ry = U * 0.31;
      return { cx: W / 2, cy: H * 0.40, rx, ry, U };
    }
    // Nokta yüz maskesinde mi? 0 = dışarı, 1 = yüz, 2 = saç, 3 = boyun/omuz
    function region(x: number, y: number, g: ReturnType<typeof geom>, ang: number): number {
      // baş eğimini tersine uygula
      const dx0 = x - g.cx, dy0 = y - g.cy;
      const c = Math.cos(-ang), s = Math.sin(-ang);
      const dx = dx0 * c - dy0 * s, dy = dx0 * s + dy0 * c;
      // yüz: hafif sivri çeneli oval
      const chin = dy > 0 ? 1 + (dy / g.ry) * 0.18 : 1;
      const fx = dx / (g.rx / chin), fy = dy / g.ry;
      if (fx * fx + fy * fy <= 1) return 1;
      // saç: daha büyük oval (yukarı kaymış) + iki yandan aşağı inen tutamlar
      const hx = dx / (g.rx * 1.42), hy = (dy + g.ry * 0.16) / (g.ry * 1.22);
      if (hx * hx + hy * hy <= 1 && dy < g.ry * 0.9) return 2;
      const strandW = g.rx * 0.5;
      if (dy > -g.ry * 0.2 && dy < g.ry * 2.1) {
        const edge = g.rx * (1.02 + Math.max(0, dy / g.ry) * 0.12);
        if (Math.abs(dx) > edge && Math.abs(dx) < edge + strandW) return 2;
      }
      // boyun + omuzlar
      if (dy > g.ry * 0.7 && dy < g.ry * 1.45 && Math.abs(dx) < g.rx * 0.42) return 3;
      if (dy >= g.ry * 1.45) {
        const sh = g.rx * (1.2 + (dy - g.ry * 1.45) / g.ry * 1.6);
        if (Math.abs(dx) < sh) return 3;
      }
      return 0;
    }

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    function update(t: number) {
      // göz kırpma
      if (blinkStart < 0 && t > nextBlink) { blinkStart = t; nextBlink = t + rnd(1800, 5200); }
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 170;
        st.blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
        if (p >= 1) { blinkStart = -1; st.blink = 0; }
      }
      // rastgele mikro mimikler: yeni hedefler
      if (t > nextMicro) {
        nextMicro = t + rnd(1400, 3800);
        st.browT = Math.random() < 0.3 ? rnd(0.25, 0.7) : 0;
        st.tiltT = rnd(-1, 1) * (Math.PI / 180) * 2.2;
        st.gazeXT = rnd(-1, 1); st.gazeYT = rnd(-0.5, 0.5);
        st.smileT = rnd(0.2, 0.6);
      }
      // dinlerken: dikkat — gözler biraz daha açık, kaş hafif yukarı
      const wideT = voice === "listening" ? 1 : 0;
      // konuşurken: hece ritmi (90-170 ms'de bir yeni ağız hedefi)
      if (voice === "speaking") {
        if (t > nextSyl) { nextSyl = t + rnd(90, 170); st.mouthT = Math.random() < 0.18 ? 0.05 : rnd(0.25, 1); }
        st.mouth = lerp(st.mouth, st.mouthT, 0.45);
      } else {
        st.mouthT = 0; st.mouth = lerp(st.mouth, 0, 0.2);
      }
      st.browLift = lerp(st.browLift, st.browT + wideT * 0.25, 0.06);
      st.tilt = lerp(st.tilt, st.tiltT, 0.03);
      st.gazeX = lerp(st.gazeX, st.gazeXT, 0.05); st.gazeY = lerp(st.gazeY, st.gazeYT, 0.05);
      st.smile = lerp(st.smile, st.smileT, 0.04);
      st.wide = lerp(st.wide, wideT, 0.08);
    }

    function drawRain(t: number, g: ReturnType<typeof geom>, ang: number) {
      ctx!.font = `${CELL - 1}px 'Courier New', monospace`;
      ctx!.textBaseline = "top";
      for (let c = 0; c < ncol; c++) {
        const col = cols[c];
        if (!reduced) col.y += col.v;
        if (col.y - col.len > rows) { col.y = -rnd(0, rows * 0.5); col.v = 0.08 + Math.random() * 0.18; col.len = 6 + Math.floor(Math.random() * 12); }
        for (let r = 0; r < rows; r++) {
          const x = c * CELL, y = r * CELL;
          const reg = region(x + CELL / 2, y + CELL / 2, g, ang);
          // damla izi parlaklığı
          const d = col.y - r;
          const trail = d >= 0 && d < col.len ? 1 - d / col.len : 0;
          let a = trail * 0.35;
          if (reg === 1) a = Math.max(a, 0.62 + trail * 0.3);
          else if (reg === 2) a = Math.max(a, 0.30 + trail * 0.25);
          else if (reg === 3) a = Math.max(a, 0.18 + trail * 0.2);
          if (a < 0.03) continue;
          const i = c * rows + r;
          if (Math.random() < 0.02) glyphs[i] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          ctx!.fillStyle = reg === 1 ? `rgba(190,255,205,${a})` : `rgba(80,230,130,${a})`;
          ctx!.fillText(glyphs[i], x, y);
        }
      }
    }

    function glowLine(path: () => void, w: number, a: number) {
      ctx!.strokeStyle = `rgba(200,255,215,${a})`; ctx!.lineWidth = w;
      ctx!.shadowColor = "#5ef58a"; ctx!.shadowBlur = 10;
      ctx!.beginPath(); path(); ctx!.stroke(); ctx!.shadowBlur = 0;
    }

    function drawFeatures(g: ReturnType<typeof geom>, ang: number) {
      ctx!.save(); ctx!.translate(g.cx, g.cy); ctx!.rotate(ang);
      ctx!.lineCap = "round"; ctx!.lineJoin = "round";
      const ex = g.rx * 0.42, ey = -g.ry * 0.10, ew = g.rx * 0.30;
      const eh = ew * 0.42 * (1 - st.blink) * (1 + st.wide * 0.18);
      // gözler (badem) + iris
      for (const sgn of [-1, 1]) {
        const x = sgn * ex;
        glowLine(() => {
          ctx!.moveTo(x - ew, ey);
          ctx!.quadraticCurveTo(x, ey - eh * 2, x + ew, ey);
          ctx!.quadraticCurveTo(x, ey + eh * 1.6, x - ew, ey);
        }, 1.6, 0.9);
        if (st.blink < 0.85) {
          const ix = x + st.gazeX * ew * 0.35, iy = ey + st.gazeY * eh * 0.5;
          ctx!.fillStyle = "rgba(160,255,190,0.85)"; ctx!.shadowColor = "#7dffa6"; ctx!.shadowBlur = 12;
          ctx!.beginPath(); ctx!.ellipse(ix, iy, ew * 0.22, Math.max(0.5, eh * 0.75), 0, 0, 6.2832); ctx!.fill();
          ctx!.fillStyle = "rgba(5,20,10,0.9)"; ctx!.shadowBlur = 0;
          ctx!.beginPath(); ctx!.ellipse(ix, iy, ew * 0.10, Math.max(0.3, eh * 0.4), 0, 0, 6.2832); ctx!.fill();
        }
        // kaş
        const by = ey - ew * 0.75 - st.browLift * ew * 0.35;
        glowLine(() => {
          ctx!.moveTo(x - ew * 1.05, by + ew * 0.12);
          ctx!.quadraticCurveTo(x + sgn * ew * 0.1, by - ew * 0.28 - st.browLift * ew * 0.12, x + ew * 1.05, by + ew * 0.1);
        }, 2.2, 0.75);
      }
      // burun (ince ipucu)
      glowLine(() => {
        ctx!.moveTo(-g.rx * 0.06, ey + g.ry * 0.12);
        ctx!.lineTo(-g.rx * 0.13, ey + g.ry * 0.46);
        ctx!.quadraticCurveTo(0, ey + g.ry * 0.53, g.rx * 0.13, ey + g.ry * 0.46);
      }, 1.2, 0.45);
      // dudaklar — üst dudak sabit, alt dudak açılır; gülümseme köşeleri kaldırır
      const my = g.ry * 0.50, mw = g.rx * 0.36, open = st.mouth * g.ry * 0.16, sm = st.smile * mw * 0.18;
      glowLine(() => {
        ctx!.moveTo(-mw, my - sm);
        ctx!.quadraticCurveTo(-mw * 0.45, my - mw * 0.16, -mw * 0.12, my - mw * 0.05);
        ctx!.quadraticCurveTo(0, my + mw * 0.02, mw * 0.12, my - mw * 0.05);
        ctx!.quadraticCurveTo(mw * 0.45, my - mw * 0.16, mw, my - sm);
      }, 1.8, 0.9);
      glowLine(() => {
        ctx!.moveTo(-mw, my - sm);
        ctx!.quadraticCurveTo(0, my + mw * 0.22 + open, mw, my - sm);
      }, 1.8, 0.9);
      if (st.mouth > 0.08) {
        // açık ağız iç karanlığı
        ctx!.fillStyle = "rgba(3,14,8,0.85)";
        ctx!.beginPath();
        ctx!.moveTo(-mw * 0.95, my - sm * 0.8);
        ctx!.quadraticCurveTo(0, my + mw * 0.02, mw * 0.95, my - sm * 0.8);
        ctx!.quadraticCurveTo(0, my + mw * 0.2 + open, -mw * 0.95, my - sm * 0.8);
        ctx!.fill();
      }
      ctx!.restore();
    }

    let raf = 0, running = true, last = 0;
    function frame(t: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return; // ~30 fps yeter
      last = t;
      update(t);
      const g = geom();
      const ang = st.tilt + (reduced ? 0 : Math.sin(t * 0.0006) * (Math.PI / 180) * 1.2);
      ctx!.clearRect(0, 0, W, H);
      drawRain(t, g, ang);
      drawFeatures(g, ang);
      // alt kenara doğru kararma (kart içine oturur)
      const fade = ctx!.createLinearGradient(0, H * 0.7, 0, H);
      fade.addColorStop(0, "rgba(4,18,10,0)"); fade.addColorStop(1, "rgba(4,18,10,0.85)");
      ctx!.fillStyle = fade; ctx!.fillRect(0, H * 0.7, W, H * 0.3);
    }
    raf = requestAnimationFrame(frame);
    function onVis() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener(VOICE_EVENT, onVoice);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
