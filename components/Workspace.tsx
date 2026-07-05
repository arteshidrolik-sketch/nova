"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AgentGraph, { type VoiceState } from "./AgentMap";
import Chat, { type ChatHandle, type Kickoff } from "./Chat";
import Dashboard from "./Dashboard";
import type { AgentActivity } from "@/lib/agents/meta";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// Çalışma alanı: üstte ajan haritası, altta sohbet + yan pano.
// Bölmeler arasındaki çizgiler tutulup sürüklenerek yeniden boyutlandırılır.
export default function Workspace({
  conversationId,
  onConversationUpdated,
  immersive = false,
  menuBar,
  onBusyChange,
  autoSend,
  onAutoSent,
  pinnedChat = false,
}: {
  conversationId: string | null;
  onConversationUpdated?: () => void;
  immersive?: boolean;
  menuBar?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
  autoSend?: Kickoff;
  onAutoSent?: () => void;
  pinnedChat?: boolean;
}) {
  const [active, setActive] = useState<AgentActivity>(null);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [wakeOn, setWakeOn] = useState(false);
  const chatRef = useRef<ChatHandle>(null);

  // Alt panonun yüksekliği (%) ve sohbetin genişliği (%) — kullanıcı sürükleyince değişir.
  const [bottomPct, setBottomPct] = useState(46);
  const [chatPct, setChatPct] = useState(42);
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const talk = () => chatRef.current?.startListening();
  const toggleWake = () => chatRef.current?.toggleWake();

  // Kayıtlı boyutları geri yükle
  useEffect(() => {
    try {
      const b = Number(localStorage.getItem("nova.ws.bottomPct"));
      if (b >= 20 && b <= 85) setBottomPct(b);
      const c = Number(localStorage.getItem("nova.ws.chatPct"));
      if (c >= 25 && c <= 75) setChatPct(c);
    } catch {
      /* yoksay */
    }
  }, []);

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

  // Dikey boyut: harita ile alt pano arasındaki çizgiyi sürükle (yukarı = alt pano büyür)
  const startVResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const rootH = rootRef.current?.getBoundingClientRect().height ?? 1;
    const onMove = (ev: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((rect.bottom - ev.clientY) / rootH) * 100;
      setBottomPct(clamp(pct, 20, 85));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        setBottomPct((v) => {
          localStorage.setItem("nova.ws.bottomPct", String(Math.round(v)));
          return v;
        });
      } catch {
        /* yoksay */
      }
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Yatay boyut: sohbet ile yan pano arasındaki çizgiyi sürükle (sağa = sohbet büyür)
  const startHResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = bottomRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setChatPct(clamp(pct, 25, 75));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        setChatPct((v) => {
          localStorage.setItem("nova.ws.chatPct", String(Math.round(v)));
          return v;
        });
      } catch {
        /* yoksay */
      }
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
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

      {/* dikey boyutlandırma çizgisi — harita ile sohbet arasında (immersive'de gizli) */}
      {!immersive && (
        <div
          onPointerDown={startVResize}
          className="group relative h-2 shrink-0 cursor-row-resize"
          style={{ touchAction: "none" }}
          title="Sürükleyerek yeniden boyutlandır"
        >
          <div
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors group-hover:h-0.5"
            style={{ background: "var(--border)" }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 transition-opacity group-hover:opacity-100"
            style={{ background: "var(--text-muted)" }}
          />
        </div>
      )}

      {/* menü barı — harita ile sohbet arasında */}
      {menuBar}

      {/* sohbet (altta) + yan pano */}
      <div
        ref={bottomRef}
        className={`flex w-full shrink-0 overflow-hidden ${
          immersive ? "opacity-0 transition-all duration-700" : "opacity-100"
        }`}
        style={{ height: immersive ? 0 : `${bottomPct}%` }}
      >
        {/* sohbet */}
        <div
          className="h-full w-full shrink-0 border-r lg:w-[var(--chat-w)]"
          style={{
            borderColor: "var(--border)",
            ["--chat-w" as string]: `${chatPct}%`,
          }}
        >
          <Chat
            ref={chatRef}
            conversationId={conversationId}
            onAgentActivity={setActive}
            onConversationUpdated={onConversationUpdated}
            onVoiceState={setVoice}
            onWakeState={setWakeOn}
            onBusy={onBusyChange}
            autoSend={autoSend}
            onAutoSent={onAutoSent}
            pinned={pinnedChat}
          />
        </div>

        {/* yatay boyutlandırma çizgisi — sadece pano görünürken (lg) */}
        <div
          onPointerDown={startHResize}
          className="group relative hidden w-2 shrink-0 cursor-col-resize lg:block"
          style={{ touchAction: "none" }}
          title="Sürükleyerek yeniden boyutlandır"
        >
          <div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-all group-hover:w-0.5"
            style={{ background: "var(--border)" }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 transition-opacity group-hover:opacity-100"
            style={{ background: "var(--text-muted)" }}
          />
        </div>

        {/* yan bilgi panosu — kalan boşluk (küçük ekranda gizli) */}
        <aside className="hidden h-full flex-1 lg:block">
          <Dashboard />
        </aside>
      </div>
    </div>
  );
}
