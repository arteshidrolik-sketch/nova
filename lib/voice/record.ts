// Mikrofon kaydı → 16kHz mono Float32Array (Whisper girdisi).
// VAD (otomatik sessizlik algılama): kullanıcı konuşmayı bitirince kayıt
// kendiliğinden durur → tek dokunuşla konuş, ikinci kez dokunmana gerek yok.
"use client";

export type Recorder = { stop: () => Promise<Float32Array | null> };

export async function startRecording(opts?: {
  onSpeechEnd?: () => void; // konuşma bitip sessizlik olunca çağrılır (otomatik dur)
}): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: BlobPart[] = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  mr.start();

  // --- VAD: konuşma sonrası sessizliği izle, olunca otomatik dur sinyali ver ---
  let vadCtx: AudioContext | null = null;
  let vadTimer: ReturnType<typeof setInterval> | null = null;
  let vadDone = false;
  const stopVad = () => {
    if (vadTimer) {
      clearInterval(vadTimer);
      vadTimer = null;
    }
    if (vadCtx) {
      try {
        vadCtx.close();
      } catch {
        /* yoksay */
      }
      vadCtx = null;
    }
  };
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    vadCtx = new AC();
    const src = vadCtx.createMediaStreamSource(stream);
    const analyser = vadCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const SILENCE = 0.014; // sessizlik eşiği (RMS)
    const SILENCE_MS = 1400; // konuşmadan sonra bu kadar sessizlik → dur
    const MAX_MS = 25000; // güvenlik tavanı (takılıp kalmasın)
    const t0 = Date.now();
    let spoke = false;
    let silenceAt = 0;
    vadTimer = setInterval(() => {
      if (vadDone || !vadCtx) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();
      if (rms > SILENCE) {
        spoke = true; // konuşma başladı
        silenceAt = 0;
      } else if (spoke) {
        if (!silenceAt) silenceAt = now;
        else if (now - silenceAt > SILENCE_MS) {
          vadDone = true;
          stopVad();
          opts?.onSpeechEnd?.();
          return;
        }
      }
      if (now - t0 > MAX_MS) {
        vadDone = true;
        stopVad();
        opts?.onSpeechEnd?.();
      }
    }, 60);
  } catch {
    // VAD kurulamazsa sorun değil — manuel (tekrar dokun) durdurma çalışır
  }

  return {
    stop: () =>
      new Promise<Float32Array | null>((resolve) => {
        stopVad();
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          if (!chunks.length) return resolve(null);
          try {
            const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
            const AC =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext })
                .webkitAudioContext;
            // 16kHz bağlam → decodeAudioData yeniden örnekler
            const ctx = new AC({ sampleRate: 16000 });
            const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
            const mono = buf.getChannelData(0).slice(); // kopya (detach)
            ctx.close();
            resolve(mono.length ? mono : null);
          } catch {
            resolve(null);
          }
        };
        try {
          mr.stop();
        } catch {
          resolve(null);
        }
      }),
  };
}
