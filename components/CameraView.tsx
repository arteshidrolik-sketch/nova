"use client";

// Gerçekçi ofis — güvenlik kamerası görünümü. Proje için üretilmiş fotoğraf
// gerçekliğindeki ofis karesi; varsa sahnenin TAMAMI için canlı videolar
// (herkes boşta / şu ajan çalışıyor) — o an kim çalışıyorsa onun videosu oynar,
// geçişler yumuşaktır. Üstte REC/saat arayüzü, her ajanın üstünde takip kutusu
// (çalışırken rol renginde parlar; tıklanınca becerileri açılır).
import { useEffect, useRef, useState } from "react";
import { TEAM_META, type Member, type TeamRole } from "@/lib/team/roles";

type Box = { x: number; y: number; w: number; h: number };
type VidState = "idle" | TeamRole;
export type CamScene = {
  width: number; height: number; createdAt: number;
  boxes: Partial<Record<TeamRole, Box>>;
  video?: { crop: Box; states: Partial<Record<VidState, boolean>>; at: number };
};

const ROLES: TeamRole[] = ["research", "manager", "coder", "marketing"];
const ACTIVE = new Set(["working", "thinking", "reviewing", "speaking"]);

export default function CameraView({
  convId, title, scene, cast, status, statusTr, tier, onOpen, labels = true,
}: {
  convId: string; title: string; scene: CamScene;
  cast: Record<TeamRole, Member>;
  status: Record<TeamRole, string>; statusTr: Record<string, string>;
  tier: Partial<Record<TeamRole, string>>;
  onOpen: (r: TeamRole) => void;
  labels?: boolean; // false: isim/durum kutuları gizli (başka projenin sahnesi geçici gösterilirken)
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const vids = useRef<Partial<Record<VidState, HTMLVideoElement | null>>>({});
  const [geo, setGeo] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // Görünen çerçeve: video varsa onun 16:9 kesiti, yoksa tüm görsel
  const crop: Box = scene.video?.crop ?? { x: 0, y: 0, w: 100, h: 100 };
  const fw = (scene.width * crop.w) / 100, fh = (scene.height * crop.h) / 100;

  // object-fit: cover hesabı → kutular kişilerin tam üstüne otursun
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight;
      const s = Math.max(W / fw, H / fh) * 1.01;
      const w = fw * s, h = fh * s;
      setGeo({ w, h, left: (W - w) / 2, top: Math.min(0, (H - h) * 0.42) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fw, fh]);

  // Hangi video: çalışan uzman > müdür > herkes boşta
  const has = scene.video?.states ?? {};
  let want: VidState = "idle";
  for (const r of ["research", "coder", "marketing"] as TeamRole[]) if (status[r] === "working" && has[r]) want = r;
  if (want === "idle" && ACTIVE.has(status.manager) && has.manager) want = "manager";
  if (!has[want]) want = "idle";
  const wantRef = useRef(want);
  wantRef.current = want;

  // yalnız görünen video oynar (diğerleri geçişten sonra durur → işlemci yorulmaz)
  useEffect(() => {
    for (const [k, v] of Object.entries(vids.current)) {
      if (!v) continue;
      if (k === want) v.play().catch(() => {});
      else setTimeout(() => { if (k !== wantRef.current) v.pause(); }, 900);
    }
  }, [want]);

  const ts = now.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const q = encodeURIComponent(convId);
  // görsel yüzdesi → çerçeve yüzdesi
  const tx = (b: Box): Box => ({ x: ((b.x - crop.x) / crop.w) * 100, y: ((b.y - crop.y) / crop.h) * 100, w: (b.w / crop.w) * 100, h: (b.h / crop.h) * 100 });

  return (
    <div ref={wrap} className="cam relative h-full w-full overflow-hidden bg-black">
      <div className="cam-drift absolute overflow-hidden" style={{ width: geo.w, height: geo.h, left: geo.left, top: geo.top }}>
        {/* sabit kare (video yüklenene kadar ve videosuz projelerde) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/office?scope=${q}&img=1&v=${scene.createdAt}`} alt="" draggable={false}
          className="cam-img absolute select-none"
          style={{ width: `${10000 / crop.w}%`, height: `${10000 / crop.h}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`, maxWidth: "none" }}
        />
        {(Object.keys(has) as VidState[]).filter((k) => has[k]).map((k) => (
          <video
            key={k} ref={(el) => { vids.current[k] = el; }}
            src={`/api/office?scope=${q}&clip=${k}&v=${scene.video?.at ?? 0}`}
            muted loop playsInline preload="auto" autoPlay={k === want}
            className="cam-vid absolute inset-0 h-full w-full"
            style={{ opacity: k === want ? 1 : 0 }}
          />
        ))}
        {labels && ROLES.map((r) => {
          const b0 = scene.boxes[r];
          if (!b0) return null;
          const b = tx(b0);
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
      <div className="cam-vignette" />
      <div className="cam-hud tl"><span className="rec" /> REC &nbsp;·&nbsp; KAM-01 &nbsp;·&nbsp; {title.toLocaleUpperCase("tr-TR")} OFİS</div>
      <div className="cam-hud tr tabular-nums">{ts}</div>
      <div className="cam-hud bl">1080p · 24fps · canlı</div>
    </div>
  );
}
