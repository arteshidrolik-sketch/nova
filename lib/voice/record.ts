// Mikrofon kaydı → 16kHz mono Float32Array (Whisper girdisi).
"use client";

export type Recorder = { stop: () => Promise<Float32Array | null> };

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: BlobPart[] = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  mr.start();

  return {
    stop: () =>
      new Promise<Float32Array | null>((resolve) => {
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
