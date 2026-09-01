"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar, { type ViewKey } from "./Sidebar";
import Files from "./Files";
import Invoices from "./Invoices";
import RadarGame from "./RadarGame";
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
  // Radar tam ekran modu: true → radar tüm ekranı kaplar; false → normal Nova
  // arayüzü + sağ üstte küçük animasyonlu radar sembolü.
  const [radarFull, setRadarFull] = useState(false);

  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
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

  // Ekran koruyucu gibi: 15 sn hiçbir hareket YOKSA tam ekran uzay modu.
  // Sohbet akarken / ses varken (chatBusy) devreye girmez.
  useEffect(() => {
    if (view !== "harita") {
      setImmersive(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      if (chatBusy) return; // meşgulken zamanlayıcıyı hiç kurma
      timer = setTimeout(() => {
        setImmersive(true);
        // En iyi çaba: tam ekrana geç (tarayıcı izin verirse)
        try {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } catch {
          /* yoksay */
        }
      }, 15000);
    };
    // Fare hareketi / dokunma → menüleri göster
    const wake = () => {
      setImmersive((prev) => (prev ? false : prev));
      arm();
    };
    // Yazma / kaydırma / tıklama → sadece zamanlayıcıyı ertele (menüleri zorla açma)
    const keepAwake = () => arm();
    arm();
    window.addEventListener("mousemove", wake, { passive: true });
    window.addEventListener("touchstart", wake, { passive: true });
    window.addEventListener("keydown", keepAwake);
    window.addEventListener("wheel", keepAwake, { passive: true });
    window.addEventListener("mousedown", keepAwake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", keepAwake);
      window.removeEventListener("wheel", keepAwake);
      window.removeEventListener("mousedown", keepAwake);
    };
  }, [view, chatBusy]);

  const hideUI = immersive && view === "harita";

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
      {hideUI && (
        <div
          className="pointer-events-none absolute bottom-3 right-4 z-20 text-[11px] tracking-wide"
          style={{ color: "var(--text-muted)", opacity: 0.6 }}
        >
ekrana tıkla: tam ekran · Boşluk: konuş · fareyi oynat: menüler
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-hidden">
        {view === "harita" ? (
          <Workspace
            conversationId={activeConv}
            onConversationUpdated={onConvUpdated}
            immersive={hideUI}
            menuBar={menuBarNode}
            onBusyChange={setChatBusy}
            autoSend={kickoff}
            onAutoSent={() => setKickoff(null)}
            pinnedChat={
              convs.find((c) => c.id === activeConv)?.pinned ?? false
            }
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

      {/* Sağ üstte her zaman duran küçük animasyonlu radar sembolü —
          tıkla → radar tam ekran. */}
      {!radarFull && (
        <button
          onClick={() => setRadarFull(true)}
          title="Radarı tam ekran aç"
          aria-label="Radarı tam ekran aç"
          className="fixed right-3 top-3 z-40 h-[74px] w-[74px] overflow-hidden rounded-2xl border"
          style={{
            borderColor: "#1c5140",
            background: "#060d0b",
            boxShadow: "0 0 22px rgba(52,211,153,.28)",
          }}
        >
          <RadarGame active={null} voice="idle" mini />
          <span
            className="pointer-events-none absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md"
            style={{ background: "rgba(6,13,11,.7)", color: "#6ee7b7" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </span>
        </button>
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
