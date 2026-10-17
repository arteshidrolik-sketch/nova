"use client";

// Nova — her sayfada açık duran sesli asistan (kadın karakter). "Nova" deyince dinler;
// gezinme komutlarını (proje aç, evrene dön, sekme aç, sus) kendisi yapar, diğer her şeyi
// açık projenin müdürüne iş olarak gönderir. Cevapları sohbet bileşeni Nova'nın sesiyle,
// metin akarken okur. Okurken uyandırma dinlemesi duraklar (kendi sesine uyanmasın);
// okuma bitince birkaç saniye "Nova" demeden devam sorusunu dinler.
import { useCallback, useEffect, useRef, useState } from "react";
import { findWake, parseCommand, type TabKey } from "@/lib/voice/commands";
import { chime, speakShort } from "@/lib/voice/female";

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecCtor = new () => Rec;
const getRec = (): RecCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

type Mode = "off" | "wake" | "command" | "busy" | "speaking";
const LABEL: Record<Mode, string> = { off: "Nova kapalı", wake: "“Nova” de", command: "Dinliyorum…", busy: "Çalışıyor…", speaking: "Nova konuşuyor" };
const FOLLOW_MS = 7000; // okuma bittikten sonra "Nova" demeden dinleme süresi

export default function NovaVoice({
  projects, openId, onOpenProject, onHome,
}: {
  projects: { id: string; title: string; updatedAt: number }[];
  openId: string | null;
  onOpenProject: (p: { id: string; title: string; updatedAt: number }) => void;
  onHome: () => void;
}) {
  const [mode, setMode] = useState<Mode>("off");
  const [heard, setHeard] = useState("");
  const modeRef = useRef<Mode>("off");
  const recRef = useRef<Rec | null>(null);
  const timerRef = useRef(0);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const ctx = useRef({ projects, openId, onOpenProject, onHome });
  ctx.current = { projects, openId, onOpenProject, onHome };
  const setM = (m: Mode) => { modeRef.current = m; setMode(m); window.dispatchEvent(new CustomEvent("nova:voice-mode", { detail: { on: m !== "off" } })); };

  const stopRec = () => { const r = recRef.current; recRef.current = null; try { r?.abort(); } catch { /* yoksay */ } };

  // Sürekli "Nova" bekleyen dinleyici
  const startWake = useCallback(() => {
    clearTimeout(timerRef.current);
    if (modeRef.current === "off" || speakingRef.current) return;
    const C = getRec(); if (!C) return;
    stopRec();
    const r = new C(); r.lang = "tr-TR"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        const w = findWake(txt);
        if (!w.hit) continue;
        if (e.results[i].isFinal && w.rest.split(" ").filter(Boolean).length >= 2) { stopRec(); handle(w.rest); return; } // "Nova, GetDriver'a geç"
        if (!e.results[i].isFinal) continue;
        stopRec(); chime(true); startCommand(); return; // yalnız "Nova" → komutu dinle
      }
    };
    r.onend = () => { if (recRef.current === r) { recRef.current = null; if (modeRef.current === "wake" || modeRef.current === "busy") timerRef.current = window.setTimeout(startWake, 250); } };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { setM("off"); alert("Mikrofon izni gerekli: adres çubuğundaki kilit simgesinden mikrofona izin ver."); } };
    recRef.current = r; setM(busyRef.current ? "busy" : "wake");
    try { r.start(); } catch { /* yoksay */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tek cümlelik komut dinleme ("Nova" sonrası ya da okuma bitince devam sorusu)
  const startCommand = useCallback((timeoutMs = 8000) => {
    clearTimeout(timerRef.current);
    if (modeRef.current === "off") return;
    const C = getRec(); if (!C) return;
    stopRec();
    const r = new C(); r.lang = "tr-TR"; r.continuous = false; r.interimResults = true;
    let got = "";
    r.onresult = (e) => {
      let t = ""; let fin = false;
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
      setHeard(t);
      if (fin) { got = t; stopRec(); clearTimeout(timerRef.current); handle(findWake(t).hit ? findWake(t).rest || t : t); }
    };
    r.onend = () => { if (recRef.current === r) { recRef.current = null; if (!got && modeRef.current === "command") { setHeard(""); startWake(); } } };
    r.onerror = () => {};
    recRef.current = r; setM("command");
    try { r.start(); } catch { /* yoksay */ }
    timerRef.current = window.setTimeout(() => { if (modeRef.current === "command" && !got) { stopRec(); setHeard(""); startWake(); } }, timeoutMs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = async (text: string) => {
    setHeard(text);
    const { projects: ps, openId: oid, onOpenProject: open, onHome: home } = ctx.current;
    const cmd = parseCommand(text, ps, !!oid);
    if (!cmd) { startWake(); return; }
    if (cmd.type === "stop") { window.dispatchEvent(new CustomEvent("nova:stop-speaking")); window.speechSynthesis?.cancel(); startWake(); return; }
    if (cmd.type === "sleep") { await speakShort("Tamam, dinlemeyi kapatıyorum."); toggle(false); return; }
    if (cmd.type === "home") { home(); await speakShort("Evrene döndüm."); startWake(); return; }
    if (cmd.type === "project") {
      const p = ps.find((x) => x.id === cmd.id); if (p) open(p);
      await speakShort(`${cmd.title} projesindeyiz.`); startWake(); return;
    }
    if (cmd.type === "tab") { window.dispatchEvent(new CustomEvent("nova:tab", { detail: cmd.key as TabKey })); await speakShort(`${cmd.label} sekmesi açık.`); startWake(); return; }
    // iş: açık projenin müdürüne
    if (!oid) { await speakShort("Hangi projede çalışalım? Örneğin GetDriver'a geç de."); startCommand(); return; }
    busyRef.current = true; setM("busy");
    window.dispatchEvent(new CustomEvent("nova:voice-send", { detail: { convId: oid, text: cmd.text } }));
    startWake(); // iş sürerken de "Nova" ile gezinebilir / "sus" diyebilirsin
  };

  // Sohbet okuması başlayınca dinlemeyi duraklat; bitince devam sorusunu dinle
  useEffect(() => {
    const onTts = (e: Event) => {
      const sp = !!(e as CustomEvent<{ speaking: boolean }>).detail?.speaking;
      speakingRef.current = sp;
      if (modeRef.current === "off") return;
      if (sp) { stopRec(); clearTimeout(timerRef.current); setM("speaking"); }
      else { busyRef.current = false; timerRef.current = window.setTimeout(() => startCommand(FOLLOW_MS), 450); }
    };
    const onDone = () => { busyRef.current = false; if (modeRef.current === "busy") setM("wake"); };
    window.addEventListener("nova:tts", onTts);
    window.addEventListener("nova:reply-done", onDone);
    return () => { window.removeEventListener("nova:tts", onTts); window.removeEventListener("nova:reply-done", onDone); };
  }, [startCommand]);

  const toggle = (on?: boolean) => {
    const want = on ?? modeRef.current === "off";
    try { localStorage.setItem("nova:wake", want ? "1" : "0"); } catch { /* yoksay */ }
    if (!want) { clearTimeout(timerRef.current); stopRec(); setM("off"); setHeard(""); chime(false); return; }
    if (!getRec()) { alert("Bu tarayıcı sesli dinlemeyi desteklemiyor. Edge ya da Chrome kullan."); return; }
    modeRef.current = "wake"; chime(true); startWake();
  };

  // önceki tercih: açıksa sayfa açılınca dinlemeye başla
  useEffect(() => {
    let on = false; try { on = localStorage.getItem("nova:wake") === "1"; } catch { /* yoksay */ }
    if (on && getRec()) { modeRef.current = "wake"; startWake(); }
    return () => { clearTimeout(timerRef.current); stopRec(); };
  }, [startWake]);

  const live = mode !== "off";
  const color = mode === "command" ? "#2ff5b5" : mode === "speaking" ? "#ff7ad9" : mode === "busy" ? "#ffd166" : live ? "#7aa2ff" : "#6b7280";
  return (
    <div className="fixed bottom-[104px] left-3 z-[120] flex items-center gap-2 sm:bottom-4 sm:left-4">
      <button
        onClick={() => toggle()}
        title={live ? "Nova dinliyor — kapatmak için tıkla (ya da “Nova, dinlemeyi kapat” de)" : "Nova'yı aç: “Nova” deyince dinler, tüm arayüzü sesle yönetirsin"}
        className="flex items-center gap-2 rounded-full p-1.5 text-[13px] font-medium shadow-lg sm:py-2 sm:pl-2 sm:pr-4"
        style={{ background: "rgba(10,12,30,.85)", border: `1px solid ${color}`, color: "#f1f5f9", backdropFilter: "blur(6px)" }}
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full" style={{ background: color }}>
          {live && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: color }} />}
          <span className="relative text-[13px] font-bold text-black">N</span>
        </span>
        <span className="hidden sm:inline">{LABEL[mode]}</span>
      </button>
      {heard && live && (
        <span className="max-w-[40vw] truncate rounded-full px-3 py-1.5 text-[12px]" style={{ background: "rgba(10,12,30,.75)", color: "#cbd5e1" }}>“{heard}”</span>
      )}
    </div>
  );
}
