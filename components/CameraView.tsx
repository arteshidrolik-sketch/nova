"use client";

// Gerçekçi ofis — güvenlik kamerası görünümü. Proje için üretilmiş fotoğraf
// gerçekliğindeki ofis karesi, yavaş kamera kayması (pan/zoom), tarama çizgileri,
// kumlanma, vinyet ve REC/saat arayüzü. Her ajanın üstünde "takip kutusu":
// çalışırken rol renginde parlar, isim/durum/model etiketi taşır; tıklanınca
// ajanın becerileri açılır.
import { useEffect, useRef, useState } from "react";
import { TEAM_META, type Member, type TeamRole } from "@/lib/team/roles";

type Box = { x: number; y: number; w: number; h: number };
export type CamScene = { width: number; height: number; createdAt: number; boxes: Partial<Record<TeamRole, Box>> };

export default function CameraView({
  convId, title, scene, cast, status, statusTr, tier, onOpen,
}: {
  convId: string; title: string; scene: CamScene;
  cast: Record<TeamRole, Member>;
  status: Record<TeamRole, string>; statusTr: Record<string, string>;
  tier: Partial<Record<TeamRole, string>>;
  onOpen: (r: TeamRole) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // object-fit: cover hesabı → kutular kişilerin tam üstüne otursun
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight, ar = scene.width / scene.height;
      const s = Math.max(W / scene.width, H / scene.height) * 1.02; // kamera kayması için az pay
      const w = scene.width * s, h = w / ar;
      setGeo({ w, h, left: (W - w) / 2, top: Math.min(0, (H - h) * 0.45) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene.width, scene.height]);

  const ts = now.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const roles: TeamRole[] = ["research", "manager", "coder", "marketing"];

  return (
    <div ref={wrap} className="cam relative h-full w-full overflow-hidden bg-black">
      <div className="cam-drift absolute" style={{ width: geo.w, height: geo.h, left: geo.left, top: geo.top }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/office?scope=${encodeURIComponent(convId)}&img=1&v=${scene.createdAt}`} alt="" className="cam-img absolute inset-0 h-full w-full select-none" draggable={false} />
        {roles.map((r) => {
          const b = scene.boxes[r];
          if (!b) return null;
          const st = status[r];
          const active = st !== "idle";
          const c = TEAM_META[r].color;
          return (
            <button
              key={r}
              onClick={() => onOpen(r)}
              className={`cam-box absolute ${active ? "on" : ""}`}
              style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, ["--c" as string]: c }}
              aria-label={`${cast[r].name}, ${TEAM_META[r].name} — ${statusTr[st]}. Becerileri aç`}
            >
              <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
              <span className="cam-tag">
                <b>{cast[r].name}</b>
                <span style={{ color: c }}>{TEAM_META[r].name}</span>
                <span className={`cam-st ${active ? "on" : ""}`}>{statusTr[st]}{st === "working" && tier[r] ? ` · ${tier[r]}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      {/* kamera dokusu */}
      <div className="cam-scan" /><div className="cam-grain" /><div className="cam-vignette" />
      {/* arayüz */}
      <div className="cam-hud tl"><span className="rec" /> REC &nbsp;·&nbsp; KAM-01 &nbsp;·&nbsp; {title.toLocaleUpperCase("tr-TR")} OFİS</div>
      <div className="cam-hud tr tabular-nums">{ts}</div>
      <div className="cam-hud bl">1080p · 25fps · IR otomatik</div>
    </div>
  );
}
