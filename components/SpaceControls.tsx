"use client";

// Evren/proje başlığındaki iki kontrol: tam ekran ve uzay müziği.
import { useEffect, useState } from "react";
import { ambientIsOn, onAmbientChange, startAmbient, stopAmbient } from "@/lib/ambient";
import { IconExpand, IconShrink, IconMusic, IconMusicOff } from "./UniverseIcons";

const KEY = "nova_music";

export default function SpaceControls() {
  const [full, setFull] = useState(false);
  const [music, setMusic] = useState(false);

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f); f();
    const off = onAmbientChange(setMusic); setMusic(ambientIsOn());
    // Müzik tercihi açıksa ilk etkileşimde başlat (tarayıcı otomatik oynatmayı engeller)
    let pref = false;
    try { pref = localStorage.getItem(KEY) === "on"; } catch { /* yoksay */ }
    const kick = () => { if (pref && !ambientIsOn()) startAmbient(); window.removeEventListener("pointerdown", kick); };
    if (pref) window.addEventListener("pointerdown", kick);
    return () => { document.removeEventListener("fullscreenchange", f); off(); window.removeEventListener("pointerdown", kick); };
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  function toggleMusic() {
    if (ambientIsOn()) { stopAmbient(); try { localStorage.setItem(KEY, "off"); } catch { /* yoksay */ } }
    else { startAmbient(); try { localStorage.setItem(KEY, "on"); } catch { /* yoksay */ } }
  }

  const btn = "flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-200 hover:scale-105";
  const style = { background: "rgba(255,255,255,.08)", border: "1px solid var(--border-strong)", color: "var(--text)", backdropFilter: "blur(8px)" };
  return (
    <div className="flex items-center gap-2">
      <button onClick={toggleMusic} className={btn} style={{ ...style, color: music ? "var(--accent)" : "var(--text-muted)" }}
        aria-label={music ? "Caz müziğini kapat" : "Caz müziğini aç"} title={music ? "Müziği kapat" : "Kafe caz müziği"}>
        {music ? <IconMusic width={18} height={18} /> : <IconMusicOff width={18} height={18} />}
      </button>
      <button onClick={toggleFull} className={btn} style={style} aria-label={full ? "Tam ekrandan çık" : "Tam ekran"} title={full ? "Tam ekrandan çık" : "Tam ekran"}>
        {full ? <IconShrink width={18} height={18} /> : <IconExpand width={18} height={18} />}
      </button>
    </div>
  );
}
