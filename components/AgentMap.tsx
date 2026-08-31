"use client";

import { useEffect, useState } from "react";
import { type AgentActivity } from "@/lib/agents/meta";
import RadarGame from "./RadarGame";

export type VoiceState = "idle" | "listening" | "speaking";

// Vendor-prefix'li tam ekran yardımcıları (Safari/eski tarayıcılar dahil)
function nativeFsElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element;
    msFullscreenElement?: Element;
  };
  return d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement || null;
}
function nativeRequestFs(): Promise<void> {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
    msRequestFullscreen?: () => Promise<void>;
  };
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  return fn ? Promise.resolve(fn.call(el)) : Promise.reject(new Error("no-fs-api"));
}
function nativeExitFs(): Promise<void> {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    msExitFullscreen?: () => Promise<void>;
  };
  const fn = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
  return fn ? Promise.resolve(fn.call(d)) : Promise.reject(new Error("no-fs-api"));
}

/**
 * Çalışma Alanı üst bölgesi. Eski uzay teması yerine RadarGame:
 * fosfor-yeşil kontrol ekranı + oynanabilir radar oyunu. Merkezde Nova
 * çekirdeği, halkalarda ajanlar; mikrofon/uyandırma/tam ekran korunur.
 */
export default function AgentGraph({
  active,
  voice,
  onMic,
  wakeOn = false,
  onToggleWake,
}: {
  active: AgentActivity;
  voice?: VoiceState;
  onMic?: () => void;
  wakeOn?: boolean;
  onToggleWake?: () => void;
}) {
  // Kullanıcının özel ajanları → radarda dış halkada işaretlenir
  const [customAgents, setCustomAgents] = useState<
    { id: string; name: string; emoji: string; color: string }[]
  >([]);
  useEffect(() => {
    let cancel = false;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        if (cancel) return;
        setCustomAgents(
          (d.agents ?? []).map(
            (a: { id: string; name: string; emoji: string; color: string }) => ({
              id: a.id,
              name: a.name,
              emoji: a.emoji,
              color: a.color,
            }),
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // Native tam ekran yoksa (iPad/iOS) CSS ile tüm ekranı kapla
  const [pseudoFs, setPseudoFs] = useState(false);
  useEffect(() => {
    const onFsChange = () => {
      if (nativeFsElement()) setPseudoFs(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPseudoFs(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleFullscreen(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (typeof document === "undefined") return;
    const isFs = !!nativeFsElement();
    if (!isFs && !pseudoFs) {
      nativeRequestFs().catch(() => setPseudoFs(true));
    } else {
      if (isFs) nativeExitFs().catch(() => {});
      setPseudoFs(false);
    }
  }

  return (
    <div
      className={
        pseudoFs
          ? "fixed inset-0 z-[9999] overflow-hidden"
          : "relative h-full w-full overflow-hidden"
      }
      style={{ background: "#060d0b" }}
    >
      {/* radar + oyun + animasyonlu arka plan */}
      <RadarGame active={active} voice={voice} customAgents={customAgents} />

      {/* tam ekran düğmesi */}
      <button
        onClick={toggleFullscreen}
        title="Tam ekran aç/kapat"
        className="absolute right-3 top-3 z-20 rounded-lg px-2.5 py-1 text-sm"
        style={{
          background: "rgba(12,26,22,0.62)",
          backdropFilter: "blur(8px)",
          border: "1px solid #1c5140",
          color: "#5f8a72",
        }}
      >
        {pseudoFs ? "🗕" : "⛶"}
      </button>

      {/* merkez çekirdeğe dokun → konuş (Boşluk tuşu da çalışır) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMic?.();
        }}
        title="Konuşmak için merkeze dokun (veya Boşluk tuşu)"
        aria-label="Konuş"
        className="absolute left-1/2 top-1/2 z-20 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "transparent", cursor: "pointer" }}
      />

      {/* ses: "Nova" ile uyandırma */}
      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <button
          onClick={onToggleWake}
          title="'Nova' diyerek sesle uyandır"
          className="rounded-full px-3 py-1 text-[11px] font-medium"
          style={{
            background: wakeOn ? "#10b98122" : "rgba(12,26,22,0.62)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${wakeOn ? "#10b981" : "#1c5140"}`,
            color: wakeOn ? "#10b981" : "#5f8a72",
          }}
        >
          {wakeOn ? "👂 'Nova' dinleniyor — kapat" : "👂 'Nova' ile uyandır"}
        </button>
      </div>
    </div>
  );
}
