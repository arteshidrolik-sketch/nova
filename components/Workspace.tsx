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
    <div className="flex h-full flex-col lg:flex-row">
      {/* harita */}
      <div
        className="relative h-1/2 border-b lg:h-full lg:flex-1 lg:border-b-0 lg:border-r"
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

      {/* sohbet */}
      <div
        className={`shrink-0 overflow-hidden transition-all duration-700 ${
          immersive
            ? "h-0 w-full opacity-0 lg:h-full lg:w-0"
            : "h-1/2 w-full opacity-100 lg:h-full lg:w-[360px]"
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
