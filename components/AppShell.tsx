"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar, { type ViewKey } from "./Sidebar";
import Workspace from "./Workspace";
import Tasks from "./Tasks";
import Loops from "./Loops";
import Briefing from "./Briefing";
import Releases from "./Releases";
import Projects from "./Projects";
import Skills from "./Skills";
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
  beceriler: "Beceriler",
  surumler: "Sürümler",
  loops: "Loops",
  ayarlar: "Ayarlar",
};

export default function AppShell() {
  const [view, setView] = useState<ViewKey>("harita");
  const [pending, setPending] = useState(0);

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
        hideUI ? "h-0 opacity-0" : "h-14 opacity-100"
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
    <div className="relative z-10 flex h-screen flex-col overflow-hidden">
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
        ) : (
          <Placeholder title={TITLES[view]} />
        )}
      </main>

      {/* harita dışı görünümlerde menü altta */}
      {view !== "harita" && menuBarNode}
    </div>
  );
}
