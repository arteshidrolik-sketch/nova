// Whisper worker istemci sarmalayıcısı — tarayıcı-içi konuşma tanıma.
"use client";

let worker: Worker | null = null;
let readyState: "none" | "loading" | "ready" = "none";

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker("/whisper-worker.js", { type: "module" });
  }
  return worker;
}

export function whisperReady(): boolean {
  return readyState === "ready";
}

// Modeli yükle (ilk kullanımda indirir). onProgress: 0-100.
export function loadWhisper(onProgress?: (pct: number) => void): Promise<void> {
  const w = ensureWorker();
  if (readyState === "ready") return Promise.resolve();
  readyState = "loading";
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d.type === "progress") onProgress?.(d.pct);
      else if (d.type === "ready") {
        readyState = "ready";
        w.removeEventListener("message", handler);
        resolve();
      } else if (d.type === "error") {
        readyState = "none";
        w.removeEventListener("message", handler);
        reject(new Error(d.error));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ type: "load" });
  });
}

let seq = 0;
// 16kHz mono Float32Array sesi metne çevir.
export function transcribe(audio: Float32Array): Promise<string> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.type === "result") {
        w.removeEventListener("message", handler);
        resolve(d.text || "");
      } else if (d.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(d.error));
      }
    };
    w.addEventListener("message", handler);
    // buffer'ı transfer et (kopya yok)
    w.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}
