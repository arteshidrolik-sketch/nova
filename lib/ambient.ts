"use client";

// Uzay ambiyans müziği — Web Audio ile tarayıcıda üretilir (dosya/lisans yok,
// hiç tekrar etmez): yavaş değişen yumuşak akor pedleri + alçak uğultu + yankılı,
// gecikmeli uzak "ışıltı" notaları. Nova konuşurken ses otomatik kısılır.
// Tarayıcılar kullanıcı etkileşimi olmadan sesi başlatmaz → start() bir tıklamadan çağrılır.

type Ambient = { ctx: AudioContext; master: GainNode; stop: () => void };
let cur: Ambient | null = null;
const LEVEL = 0.16, DUCK = 0.045;
const listeners = new Set<(on: boolean) => void>();

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// La minör kipinde, ambiyans akorlar (MIDI)
const CHORDS = [
  [45, 52, 57, 60, 64, 71], // Am(add9)
  [41, 48, 57, 60, 64, 67], // Fmaj7
  [48, 55, 59, 64, 67, 71], // Cmaj7
  [43, 50, 59, 62, 66, 69], // G6
  [40, 47, 55, 59, 62, 67], // Em7
];
const SHIMMER = [69, 71, 72, 76, 79, 81, 83, 84, 88]; // pentatonik üst ses

function impulse(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

export function ambientIsOn() { return !!cur; }
export function onAmbientChange(fn: (on: boolean) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function notify() { for (const f of listeners) f(!!cur); }

export function startAmbient() {
  if (cur) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 5.5);
  const wet = ctx.createGain(); wet.gain.value = 0.85; reverb.connect(wet).connect(master);
  const dry = ctx.createGain(); dry.gain.value = 0.35; dry.connect(master);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 0.4;
  lp.connect(dry); lp.connect(reverb);
  // filtre kesimini çok yavaş dalgalandır → "nefes alan" ses
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.035;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 450; lfo.connect(lfoAmt).connect(lp.frequency); lfo.start();
  // alçak uğultu
  const drone = ctx.createOscillator(); drone.type = "sine"; drone.frequency.value = hz(33);
  const dg = ctx.createGain(); dg.gain.value = 0.07; drone.connect(dg).connect(lp); drone.start();
  // ışıltı yankısı (gecikme + geri besleme)
  const delay = ctx.createDelay(2); delay.delayTime.value = 0.62;
  const fb = ctx.createGain(); fb.gain.value = 0.42; delay.connect(fb).connect(delay);
  const shimmerBus = ctx.createGain(); shimmerBus.gain.value = 0.6;
  shimmerBus.connect(delay); shimmerBus.connect(reverb); delay.connect(reverb);

  const timers: number[] = [];
  let ci = 0;
  const playChord = () => {
    const t = ctx.currentTime, dur = 16, att = 5, rel = 6;
    for (const n of CHORDS[ci % CHORDS.length]) {
      for (const [type, det] of [["triangle", -7], ["sine", 6]] as const) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(n); o.detune.value = det;
        const g = ctx.createGain(); const peak = n < 50 ? 0.05 : 0.028;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
        g.gain.setValueAtTime(peak, t + dur - rel); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(lp); o.start(t); o.stop(t + dur + 0.1);
      }
    }
    ci++;
    timers.push(window.setTimeout(playChord, (dur - rel + 1) * 1000)); // akorlar üst üste biner
  };
  const shimmer = () => {
    const t = ctx.currentTime;
    const n = SHIMMER[Math.floor(Math.random() * SHIMMER.length)];
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    o.connect(g).connect(shimmerBus); o.start(t); o.stop(t + 3.6);
    timers.push(window.setTimeout(shimmer, 2500 + Math.random() * 5500));
  };
  playChord(); timers.push(window.setTimeout(shimmer, 3000));
  master.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 3);

  // Nova konuşurken kıs
  const onVoice = (e: Event) => {
    const speaking = (e as CustomEvent<string>).detail === "speaking";
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(speaking ? DUCK : LEVEL, ctx.currentTime, 0.4);
  };
  window.addEventListener("nova:voice", onVoice);

  cur = {
    ctx, master,
    stop: () => {
      window.removeEventListener("nova:voice", onVoice);
      for (const id of timers) clearTimeout(id);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => ctx.close().catch(() => {}), 1800);
    },
  };
  notify();
}

export function stopAmbient() {
  if (!cur) return;
  cur.stop(); cur = null; notify();
}
