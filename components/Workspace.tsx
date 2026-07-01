"use client";

import { useEffect, useRef, useState } from "react";
import AgentGraph, { type VoiceState } from "./AgentMap";
import Chat, { type ChatHandle } from "./Chat";
import type { AgentActivity } from "@/lib/agents/meta";

// Çalışma alanı: solda ajan haritası, sağda tam sohbet — aynı sayfada.
export default function Workspace({
  conversationId,
  onConversationUpdated,
  immersive = false,
}: {
  conversationId: string | null;
  onConversationUpdated?: () => void;
  immersive?: boolean;
}) {
  const [active, setActive] = useState<AgentActivity>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [wakeOn, setWakeOn] = useState(false);
  const chatRef = useRef<ChatHandle>(null);

  const talk = () => chatRef.current?.startListening();
  const toggleWake = () => chatRef.current?.toggleWake();

  // Boşluk tuşu ile konuş (input/textarea'da yazarken hariç)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      talk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* harita (üstte) */}
      <div
        className="relative min-h-0 flex-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <AgentGraph
          active={active}
          voice={voice}
          onMic={talk}
          wakeOn={wakeOn}
          onToggleWake={toggleWake}
        />
      </div>

      {/* sohbet (altta, tam genişlik) */}
      <div
        className={`w-full shrink-0 overflow-hidden transition-all duration-700 ${
          immersive ? "h-0 opacity-0" : "h-[46%] opacity-100"
        }`}
      >
        <Chat
          ref={chatRef}
          conversationId={conversationId}
          onAgentActivity={setActive}
          onConversationUpdated={onConversationUpdated}
          onVoiceState={setVoice}
          onWakeState={setWakeOn}
        />
      </div>
    </div>
  );
}
