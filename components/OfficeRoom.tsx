"use client";

// Ekip ofisinin 3B arka planı: CSS 3B ile gerçek bir oda kutusu (zemin, tavan,
// arka ve yan duvarlar perspektifle). Pencereden akşam şehri (ışıklar yanıp söner,
// bulutlar kayar), tavandan sarkan lambalar, bitkiler, kitaplık, beyaz tahta,
// canlı duvar saati, buharı tüten kahve makinesi, havada süzülen toz.
// Fare hareketiyle kamera hafifçe döner (derinlik hissi). Hareket azaltma
// tercihi açıksa animasyonlar CSS'te kapanır.
import { useEffect, useRef, useState } from "react";

export default function OfficeRoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // fareyle hafif kamera dönüşü
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${(x * 5).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-y * 2.5).toFixed(2)}deg`);
      });
    };
    const onLeave = () => { el.style.setProperty("--ry", "0deg"); el.style.setProperty("--rx", "0deg"); };
    const host = el.parentElement ?? el;
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => { host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerleave", onLeave); cancelAnimationFrame(raf); };
  }, []);

  const hDeg = ((now.getHours() % 12) + now.getMinutes() / 60) * 30;
  const mDeg = (now.getMinutes() + now.getSeconds() / 60) * 6;
  const sDeg = now.getSeconds() * 6;

  return (
    <div ref={ref} className="room3d" aria-hidden>
      <div className="room3d-stage">
        {/* arka duvar */}
        <div className="room3d-face room3d-back">
          <div className="room3d-windows">
            {[0, 1, 2].map((i) => (
              <div key={i} className="room3d-window">
                <div className="room3d-sky" />
                <div className="room3d-cloud" style={{ top: `${18 + i * 9}%`, animationDelay: `${-i * 23}s` }} />
                <div className="room3d-cloud small" style={{ top: `${8 + i * 7}%`, animationDelay: `${-i * 31 - 12}s` }} />
                <Skyline seed={i} />
              </div>
            ))}
          </div>
          {/* beyaz tahta */}
          <div className="room3d-board">
            <svg viewBox="0 0 120 70" width="100%" height="100%">
              <path d="M10 18 Q30 8 50 18 T90 16" stroke="#3b82f6" strokeWidth="2" fill="none" />
              <path d="M12 34 L44 34 M12 42 L36 42 M12 50 L40 50" stroke="#64748b" strokeWidth="2" />
              <rect x="60" y="30" width="16" height="14" fill="#fde68a" transform="rotate(-6 68 37)" />
              <rect x="82" y="34" width="16" height="14" fill="#a7f3d0" transform="rotate(5 90 41)" />
              <rect x="70" y="50" width="16" height="12" fill="#fbcfe8" transform="rotate(-3 78 56)" />
            </svg>
          </div>
          {/* duvar saati */}
          <div className="room3d-clock">
            <svg viewBox="0 0 40 40" width="100%" height="100%">
              <circle cx="20" cy="20" r="18" fill="#f8fafc" stroke="#334155" strokeWidth="2.5" />
              {Array.from({ length: 12 }).map((_, i) => (
                <line key={i} x1="20" y1="4.5" x2="20" y2="7" stroke="#475569" strokeWidth="1.2" transform={`rotate(${i * 30} 20 20)`} />
              ))}
              <line x1="20" y1="20" x2="20" y2="11" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${hDeg} 20 20)`} />
              <line x1="20" y1="20" x2="20" y2="7.5" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${mDeg} 20 20)`} />
              <line x1="20" y1="22" x2="20" y2="6.5" stroke="#ef4444" strokeWidth=".8" transform={`rotate(${sDeg} 20 20)`} />
              <circle cx="20" cy="20" r="1.4" fill="#0f172a" />
            </svg>
          </div>
          {/* duvar rafı + kahve makinesi */}
          <div className="room3d-shelf">
            <div className="room3d-coffee">
              <span className="steam s1" /><span className="steam s2" /><span className="steam s3" />
            </div>
          </div>
        </div>

        {/* zemin */}
        <div className="room3d-face room3d-floor"><div className="room3d-rug" /></div>
        {/* tavan */}
        <div className="room3d-face room3d-ceiling" />
        {/* sol duvar: kitaplık */}
        <div className="room3d-face room3d-left">
          <div className="room3d-bookcase">
            {[0, 1, 2].map((row) => (
              <div key={row} className="room3d-books">
                {Array.from({ length: 9 }).map((_, i) => (
                  <span key={i} style={{ height: `${62 + ((i * 37 + row * 13) % 34)}%`, background: BOOKS[(i + row * 3) % BOOKS.length] }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* sağ duvar: pano */}
        <div className="room3d-face room3d-right">
          <div className="room3d-poster">
            <svg viewBox="0 0 60 80" width="100%" height="100%">
              <rect width="60" height="80" fill="#1e1b4b" />
              <circle cx="30" cy="32" r="16" fill="url(#pg)" />
              <defs><radialGradient id="pg"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#6366f1" /></radialGradient></defs>
              <ellipse cx="30" cy="32" rx="26" ry="6" fill="none" stroke="#f0abfc" strokeWidth="1.5" />
              <rect x="12" y="60" width="36" height="4" rx="2" fill="#e0e7ff" />
              <rect x="18" y="68" width="24" height="3" rx="1.5" fill="#a5b4fc" />
            </svg>
          </div>
        </div>

        {/* sarkan lambalar */}
        {[22, 50, 78].map((x, i) => (
          <div key={x} className="room3d-lamp" style={{ left: `${x}%`, animationDelay: `${-i * 1.7}s` }}>
            <span className="cord" /><span className="shade" /><span className="glow" />
          </div>
        ))}
        {/* bitkiler */}
        <Plant className="room3d-plant left" />
        <Plant className="room3d-plant right" />
      </div>
      {/* havada süzülen toz */}
      <div className="room3d-dust">
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${-(i * 1.9) % 14}s`, animationDuration: `${10 + (i % 5) * 2}s` }} />
        ))}
      </div>
    </div>
  );
}

const BOOKS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

function Skyline({ seed }: { seed: number }) {
  const blds = Array.from({ length: 7 }).map((_, i) => {
    const w = 10 + ((i * 7 + seed * 5) % 8);
    const h = 30 + ((i * 23 + seed * 17) % 45);
    return { x: i * 15 - 2, w, h };
  });
  return (
    <svg className="room3d-skyline" viewBox="0 0 100 100" preserveAspectRatio="none">
      {blds.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={100 - b.h} width={b.w} height={b.h} fill={i % 2 ? "#241a4a" : "#2d2257"} />
          {Array.from({ length: Math.floor(b.h / 9) }).map((_, r) =>
            [0, 1].map((c) => (
              <rect key={`${r}-${c}`} className={(r + c + i + seed) % 3 === 0 ? "win tw" : "win"}
                style={{ animationDelay: `${-((r * 7 + c * 3 + i * 5) % 9)}s` }}
                x={b.x + 2 + c * (b.w / 2 - 1)} y={100 - b.h + 4 + r * 9} width={b.w / 2 - 3.5} height="4"
                fill={(r * 3 + c + i) % 4 === 0 ? "#3b3270" : "#ffd27a"} />
            )),
          )}
        </g>
      ))}
    </svg>
  );
}

function Plant({ className }: { className: string }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 60 90" width="100%" height="100%">
        <g className="leaves">
          <path d="M30 60 Q8 40 12 18 Q26 34 30 60" fill="#22c55e" />
          <path d="M30 60 Q52 40 48 16 Q34 34 30 60" fill="#16a34a" />
          <path d="M30 60 Q22 30 30 6 Q38 30 30 60" fill="#4ade80" />
          <path d="M30 62 Q6 56 2 38 Q20 44 30 62" fill="#15803d" />
          <path d="M30 62 Q54 56 58 38 Q40 44 30 62" fill="#22c55e" />
        </g>
        <path d="M16 60 L44 60 L40 88 L20 88 Z" fill="#c2410c" />
        <rect x="14" y="57" width="32" height="6" rx="2" fill="#ea580c" />
      </svg>
    </div>
  );
}
