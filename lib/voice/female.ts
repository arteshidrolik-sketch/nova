"use client";
// Nova'nın sesi: her zaman kadın Türkçe ses. Edge'de doğal "Emel" (ücretsiz),
// başka kadın Türkçe ses; hiç yoksa (ör. Chrome'da yalnız Tolga) Türkçe sesi ince tonla.

const FEMALE = ["emel", "filiz", "yelda", "seda", "aysel", "zeynep", "female", "kad", "google"];

export function pickFemaleVoice(): { voice: SpeechSynthesisVoice | null; pitch: number } {
  if (typeof window === "undefined" || !window.speechSynthesis) return { voice: null, pitch: 1 };
  const list = window.speechSynthesis.getVoices();
  const tr = list.filter((v) => v.lang.toLowerCase().startsWith("tr"));
  const isF = (v: SpeechSynthesisVoice) => FEMALE.some((k) => v.name.toLowerCase().includes(k));
  const f = tr.find((v) => isF(v) && /natural|online/i.test(v.name)) || tr.find(isF);
  if (f) return { voice: f, pitch: 1 };
  return { voice: tr[0] ?? null, pitch: 1.35 };
}

// Kısa onay cümlesi ("GetDriver'ı açıyorum") — sohbet okumasından bağımsız, hızlı
export function speakShort(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return resolve();
    const s = window.speechSynthesis;
    const { voice, pitch } = pickFemaleVoice();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "tr-TR";
    u.pitch = pitch; u.rate = 1.15;
    const done = () => { window.dispatchEvent(new CustomEvent("nova:tts", { detail: { speaking: false } })); resolve(); };
    u.onend = done; u.onerror = done;
    window.dispatchEvent(new CustomEvent("nova:tts", { detail: { speaking: true } }));
    s.cancel();
    s.speak(u);
    setTimeout(done, text.length * 120 + 3000); // onend gelmezse
  });
}

// Uyandırma sinyali (kısa iki notalı "dıt") — konuşmaktan hızlı
export function chime(up = true) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t = ctx.currentTime;
    for (const [i, f] of (up ? [660, 990] : [990, 660]).entries()) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0, t + i * 0.09); g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.12);
      o.connect(g).connect(ctx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.14);
    }
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch { /* yoksay */ }
}
