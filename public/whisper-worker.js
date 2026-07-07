// Tarayıcı-içi konuşma tanıma (Whisper) — Web Worker.
// transformers.js CDN'den yüklenir (ek npm bağımlılığı yok). Model tarayıcıda
// önbelleğe alınır; ses buluta GİTMEZ, tamamen yerel çalışır.
import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = "Xenova/whisper-base"; // çok dilli (Türkçe dahil), quantized ~50MB

let transcriber = null;
let loading = null;

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", MODEL, {
      quantized: true,
      progress_callback: (p) => {
        if (p && p.status === "progress") {
          self.postMessage({
            type: "progress",
            pct: Math.round(p.progress || 0),
          });
        }
      },
    });
  }
  transcriber = await loading;
  return transcriber;
}

self.onmessage = async (e) => {
  const { type, id, audio } = e.data || {};
  try {
    if (type === "load") {
      await getTranscriber();
      self.postMessage({ type: "ready" });
    } else if (type === "transcribe") {
      const t = await getTranscriber();
      const out = await t(audio, {
        language: "turkish",
        task: "transcribe",
        chunk_length_s: 30,
      });
      const text = out && typeof out.text === "string" ? out.text.trim() : "";
      self.postMessage({ type: "result", id, text });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      error: String((err && err.message) || err),
    });
  }
};
