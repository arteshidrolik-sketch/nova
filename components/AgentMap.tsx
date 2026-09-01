"use client";

import { type AgentActivity } from "@/lib/agents/meta";
import { useEffect, useState } from "react";
import RadarGame from "./RadarGame";

export type VoiceState = "idle" | "listening" | "speaking";

type CustomAgent = { id: string; name: string; emoji: string; color: string };

/**
 * Çalışma Alanı üst bölgesi: RadarGame (fosfor-yeşil kontrol ekranı +
 * oynanabilir radar). Merkez Nova çekirdeği ses durumuna tepki verir; ajanlar
 * halkalarda. Mikrofon (merkeze dokun) ve "Nova" ile uyandırma korunur.
 * Tam ekran radara geçiş AppShell'deki köşe mini-radar simgesiyle yapılır.
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
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
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

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: "#060d0b" }}
    >
      {/* radar + oyun + animasyonlu arka plan */}
      <RadarGame active={active} voice={voice} customAgents={customAgents} />

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
