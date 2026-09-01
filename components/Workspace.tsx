"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Chat, { type ChatHandle, type Kickoff } from "./Chat";
import Dashboard from "./Dashboard";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// Çalışma alanı: üstte sekme çubuğu, altta sohbet + yan pano. Radar buradan
// kaldırıldı; radar yalnızca sağ üstteki mini simge / tam ekran modunda yaşar.
export default function Workspace({
  conversationId,
  onConversationUpdated,
  menuBar,
  autoSend,
  onAutoSent,
  pinnedChat = false,
}: {
  conversationId: string | null;
  onConversationUpdated?: () => void;
  menuBar?: ReactNode;
  autoSend?: Kickoff;
  onAutoSent?: () => void;
  pinnedChat?: boolean;
}) {
  const chatRef = useRef<ChatHandle>(null);

  // Sohbetin genişliği (%) — kullanıcı sürükleyince değişir.
  const [chatPct, setChatPct] = useState(46);
  const bottomRef = useRef<HTMLDivElement>(null);

  const talk = () => chatRef.current?.startListening();

  useEffect(() => {
    try {
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
    <div className="flex h-full flex-col">
      {/* sekme çubuğu üstte */}
      {menuBar}

      {/* sohbet + yan pano */}
      <div
        ref={bottomRef}
        className="flex w-full min-h-0 flex-1 overflow-hidden"
      >
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
            onConversationUpdated={onConversationUpdated}
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
