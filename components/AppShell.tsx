"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar, { type ViewKey } from "./Sidebar";
import Files from "./Files";
import Invoices from "./Invoices";
import RadarGame from "./RadarGame";
import type { ChatHandle } from "./Chat";

// Sesli karşılama metni: hal hatır + ne üzerine çalışılacağı
const GREETING =
  "Merhaba! Ben Nova. Nasılsın, bugün nasıl gidiyor? Bugün ne üzerinde çalışmak istersin? " +
  "Hazır olduğunda 'arayüzü aç' de, ya da doğrudan ne yapmak istediğini söyle.";
import Workspace from "./Workspace";
import Tasks from "./Tasks";
import Loops from "./Loops";
import Briefing from "./Briefing";
import Releases from "./Releases";
import Projects from "./Projects";
import Skills from "./Skills";
import Guardrail from "./Guardrail";
import Audit from "./Audit";
import Agents from "./Agents";
import type { Kickoff } from "./Chat";

export type ConvMeta = {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
};

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="rounded-xl border p-8 text-center text-sm"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
        }}
      >
        <div className="mb-1 text-base font-medium" style={{ color: "var(--text)" }}>
          {title}
        </div>
        Bu bölüm sonraki fazlarda gelecek.
      </div>
    </div>
  );
}

const TITLES: Record<ViewKey, string> = {
  harita: "Çalışma Alanı",
  brifing: "Brifing",
  tasks: "Görevler",
  projeler: "Projeler",
  dosyalar: "Dosyalar",
  fatura: "Fatura",
  beceriler: "Beceriler",
  surumler: "Sürümler",
  loops: "Loops",
  ajanlar: "Ajanlar",
  guardrail: "Kontrol",
  denetim: "Denetim",
  ayarlar: "Ayarlar",
};

export default function AppShell() {
  const [view, setView] = useState<ViewKey>("harita");
  const [pending, setPending] = useState(0);
  // Radar/oyun tam ekran modu: true → tüm ekranı kaplar; false → normal Nova.
  const [radarFull, setRadarFull] = useState(false);

  // Sesli karşılama katmanı: açılışta Nova'yı sesle başlat; "arayüzü aç" kapatır.
  const [voiceWelcome, setVoiceWelcome] = useState(true);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "speaking">("idle");
  const [voiceStarted, setVoiceStarted] = useState(false);
  const chatHandleRef = useRef<ChatHandle | null>(null);
  function startVoice() {
    const h = chatHandleRef.current;
    if (!h) return;
    setVoiceStarted(true);
    h.greet(GREETING);
  }
  // ESC ile oyundan çık
  useEffect(() => {
    if (!radarFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRadarFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [radarFull]);

  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [kickoff, setKickoff] = useState<Kickoff>(null);

  const refreshPending = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks");
      const d = await r.json();
      setPending(
        (d.tasks ?? []).filter((t: { status: string }) => t.status === "proposed")
          .length,
      );
    } catch {
      /* yoksay */
    }
  }, []);

  const refreshConvs = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      const d = await r.json();
      return (d.conversations ?? []) as ConvMeta[];
    } catch {
      return [];
    }
  }, []);

  // İlk yükleme: sohbet listesini al, yoksa bir tane oluştur
  useEffect(() => {
    (async () => {
      let list = await refreshConvs();
      if (list.length === 0) {
        await fetch("/api/conversations", { method: "POST" });
        list = await refreshConvs();
      }
      setConvs(list);
      setActiveConv((prev) => prev ?? list[0]?.id ?? null);
    })();
  }, [refreshConvs]);

  useEffect(() => {
    refreshPending();
    const id = setInterval(refreshPending, 5000);
    return () => clearInterval(id);
  }, [refreshPending]);

  // Eski uzay ekran-koruyucusu kaldırıldı. Radar artık yalnızca köşedeki mini
  // simgeyle (deliberate) tam ekran açılır; Çalışma Alanı sade kalır.
  const hideUI = false;

  const menuBarNode = (
    <div
      className={`shrink-0 overflow-hidden transition-all duration-500 ${
        hideUI ? "h-0 opacity-0" : "h-24 opacity-100"
      }`}
    >
      <Sidebar
        active={view}
        onSelect={setView}
        pendingCount={pending}
        conversations={convs}
        activeConv={activeConv}
        onNewConv={newConversation}
        onSelectConv={selectConversation}
        onRenameConv={renameConversation}
        onDeleteConv={deleteConversation}
        onOpenRadar={() => setRadarFull(true)}
      />
    </div>
  );

  async function newConversation() {
    const r = await fetch("/api/conversations", { method: "POST" });
    const d = await r.json();
    setConvs(await refreshConvs());
    setActiveConv(d.conversation.id);
    setView("harita");
  }

  // Özel ajanla yeni bir sohbet başlat (o ajana kilitli)
  async function startAgentChat(agentId: string, name: string) {
    const r = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forcedAgent: agentId, title: name }),
    });
    const d = await r.json();
    setConvs(await refreshConvs());
    setActiveConv(d.conversation.id);
    setView("harita");
  }

  function selectConversation(id: string) {
    setActiveConv(id);
    setView("harita");
  }

  // Yeni proje başlatıldı: projeye ait sohbeti aç, Çalışma Alanı'na geç, prompt'u otomatik gönder
  async function startProject(
    project: { conversationId?: string },
    payload: Kickoff,
  ) {
    setConvs(await refreshConvs());
    if (project.conversationId) setActiveConv(project.conversationId);
    setKickoff(payload);
    setView("harita");
  }

  // Proje aktifleştirildi: projenin sohbetini aç (yoksa sunucu oluşturur)
  async function activateProject(id: string) {
    const r = await fetch(`/api/projects/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "activate" }),
    });
    const d = await r.json().catch(() => ({}));
    setConvs(await refreshConvs());
    if (d?.conversationId) setActiveConv(d.conversationId);
    setView("harita");
  }

  async function renameConversation(id: string, title: string) {
    await fetch(`/api/conversations/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setConvs(await refreshConvs());
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    let list = await refreshConvs();
    if (list.length === 0) {
      await fetch("/api/conversations", { method: "POST" });
      list = await refreshConvs();
    }
    setConvs(list);
    if (activeConv === id) setActiveConv(list[0]?.id ?? null);
  }

  const onConvUpdated = useCallback(async () => {
    setConvs(await refreshConvs());
  }, [refreshConvs]);

  return (
    <div className="relative z-10 flex h-dvh flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-hidden">
        {view === "harita" ? (
          <Workspace
            conversationId={activeConv}
            onConversationUpdated={onConvUpdated}
            menuBar={menuBarNode}
            autoSend={kickoff}
            onAutoSent={() => setKickoff(null)}
            pinnedChat={
              convs.find((c) => c.id === activeConv)?.pinned ?? false
            }
            onChatHandle={(h) => {
              chatHandleRef.current = h;
            }}
            onUiCommand={(cmd) => {
              if (cmd === "open_ui") setVoiceWelcome(false);
            }}
            onVoiceState={setVoiceState}
          />
        ) : view === "tasks" ? (
          <Tasks onChange={refreshPending} />
        ) : view === "loops" ? (
          <Loops onChange={refreshPending} />
        ) : view === "brifing" ? (
          <Briefing />
        ) : view === "surumler" ? (
          <Releases onChange={refreshPending} />
        ) : view === "projeler" ? (
          <Projects onStart={startProject} onActivate={activateProject} />
        ) : view === "beceriler" ? (
          <Skills />
        ) : view === "guardrail" ? (
          <Guardrail />
        ) : view === "denetim" ? (
          <Audit />
        ) : view === "ajanlar" ? (
          <Agents onStartChat={startAgentChat} />
        ) : view === "dosyalar" ? (
          <Files />
        ) : view === "fatura" ? (
          <Invoices />
        ) : (
          <Placeholder title={TITLES[view]} />
        )}
      </main>

      {/* harita dışı görünümlerde menü altta */}
      {view !== "harita" && menuBarNode}

      {/* Sesli karşılama katmanı — tarayıcı ses/mikrofon için bir dokunuş ister.
          "Nova ile başla" → karşılama konuşması → dinleme → "arayüzü aç" kapatır. */}
      {voiceWelcome && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 text-center"
          style={{ background: "radial-gradient(70% 70% at 50% 40%, #0e1a30, #060a14 75%)" }}
        >
          <span className="relative flex h-28 w-28 items-center justify-center rounded-full">
            <span
              className="nova-orb absolute inset-0 rounded-full"
              style={{
                boxShadow:
                  voiceState === "listening"
                    ? "0 0 60px rgba(79,216,255,.7)"
                    : voiceState === "speaking"
                      ? "0 0 60px rgba(167,139,250,.7)"
                      : "0 0 36px rgba(79,216,255,.35)",
                transition: "box-shadow .3s ease",
              }}
            />
            <span className="relative text-3xl font-bold text-black">N</span>
          </span>
          <div>
            <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: 30, fontWeight: 700, color: "#e8eefb" }}>
              Nova
            </div>
            <div
              style={{ fontFamily: "var(--font-plex), monospace", fontSize: 12, letterSpacing: ".14em", color: "#8a97b5", marginTop: 6 }}
            >
              {voiceState === "listening"
                ? "DİNLİYORUM…"
                : voiceState === "speaking"
                  ? "KONUŞUYOR…"
                  : voiceStarted
                    ? "HAZIR — 'NOVA' DEYİP KONUŞ"
                    : "SESLİ ASİSTAN"}
            </div>
          </div>
          {!voiceStarted ? (
            <button
              onClick={startVoice}
              className="rounded-2xl px-8 py-4 text-base font-bold"
              style={{ background: "linear-gradient(135deg,#8be9ff,#4fd8ff)", color: "#04141f", boxShadow: "0 0 30px rgba(79,216,255,.45)" }}
            >
              🎙️ Nova ile başla
            </button>
          ) : (
            <button
              onClick={() => chatHandleRef.current?.startListening()}
              className="rounded-2xl px-6 py-3 text-sm font-bold"
              style={{ background: "rgba(79,216,255,.14)", border: "1px solid rgba(79,216,255,.5)", color: "#8be9ff" }}
            >
              🎤 Konuş
            </button>
          )}
          <button
            onClick={() => setVoiceWelcome(false)}
            className="text-xs"
            style={{ color: "#5f6f8f", textDecoration: "underline" }}
          >
            Arayüzü aç (sessiz devam et)
          </button>
          <div style={{ fontFamily: "var(--font-plex), monospace", fontSize: 11, color: "#5f6f8f", maxWidth: 360, lineHeight: 1.6 }}>
            Nova seni sesle karşılar, ne üzerinde çalışacağını sorar. İstediğin zaman &quot;arayüzü aç&quot; de.
          </div>
        </div>
      )}

      {/* Radar tam ekran katmanı */}
      {radarFull && (
        <div className="fixed inset-0 z-50" style={{ background: "#060d0b" }}>
          <RadarGame active={null} voice="idle" />
          <button
            onClick={() => setRadarFull(false)}
            title="Küçült — Nova arayüzüne dön"
            aria-label="Küçült — Nova arayüzüne dön"
            className="absolute right-3 top-3 z-[60] flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
            style={{
              background: "rgba(12,26,22,.72)",
              border: "1px solid #1c5140",
              color: "#6ee7b7",
              backdropFilter: "blur(8px)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v6H3M21 15h-6v6M9 9 3 3M21 21l-6-6" /></svg>
            Nova&apos;ya dön
          </button>
        </div>
      )}
    </div>
  );
}
