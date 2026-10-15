"use client";

// Kafe caz fon müziği — Web Audio ile tarayıcıda üretilir (dosya/lisans yok,
// hiç birebir tekrar etmez): swing ritimde Rhodes tarzı elektrik piyano akorları,
// yürüyen kontrbas, fırça + ride davul, ara sıra vibrafon melodisi ve çok hafif
// kafe uğultusu. Nova konuşurken ses otomatik kısılır.
// Tarayıcılar kullanıcı etkileşimi olmadan sesi başlatmaz → start() bir tıklamadan çağrılır.

type Ambient = { ctx: AudioContext; master: GainNode; stop: () => void };
let cur: Ambient | null = null;
const LEVEL = 0.22, DUCK = 0.06;
const listeners = new Set<(on: boolean) => void>();

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// Akor kalitesi → (kök hariç) piyano voicing aralıkları, bas için akor sesleri, melodi dizisi
type Q = "maj7" | "m7" | "7" | "dim7" | "m6";
const QUAL: Record<Q, { voice: number[]; tones: number[]; scale: number[] }> = {
  maj7: { voice: [4, 7, 11, 14], tones: [0, 4, 7, 11], scale: [0, 2, 4, 7, 9, 11] },
  m7: { voice: [3, 7, 10, 14], tones: [0, 3, 7, 10], scale: [0, 2, 3, 5, 7, 10] },
  "7": { voice: [4, 10, 14, 21], tones: [0, 4, 7, 10], scale: [0, 2, 4, 7, 9, 10] },
  dim7: { voice: [3, 6, 9, 12], tones: [0, 3, 6, 9], scale: [0, 3, 6, 9] },
  m6: { voice: [3, 7, 9, 14], tones: [0, 3, 7, 9], scale: [0, 2, 3, 5, 7, 9] },
};
// Fa majörde 16 ölçülük döngü (pc: 0=Do … 5=Fa)
const PROG: [number, Q][] = [
  [5, "maj7"], [2, "7"], [7, "m7"], [0, "7"], [9, "m7"], [2, "7"], [7, "m7"], [0, "7"],
  [10, "maj7"], [10, "m6"], [9, "m7"], [8, "dim7"], [7, "m7"], [0, "7"], [5, "maj7"], [0, "7"],
];

function impulse(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}
function noiseBuf(ctx: AudioContext, seconds: number, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
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
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  // küçük salon yankısı
  const reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 1.8);
  const wet = ctx.createGain(); wet.gain.value = 0.32; reverb.connect(wet).connect(master);
  const bus = (level: number, rev: number) => {
    const g = ctx.createGain(); g.gain.value = level; g.connect(master);
    const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(reverb);
    return g;
  };
  const pianoBus = bus(0.5, 0.6), bassBus = bus(0.75, 0.15), drumBus = bus(0.5, 0.35), vibesBus = bus(0.3, 0.8), roomBus = bus(1, 0);

  // Rhodes tremolosu
  const trem = ctx.createGain(); trem.gain.value = 0.85; trem.connect(pianoBus);
  const tl = ctx.createOscillator(); tl.frequency.value = 4.2;
  const ta = ctx.createGain(); ta.gain.value = 0.15; tl.connect(ta).connect(trem.gain); tl.start();

  const white = noiseBuf(ctx, 2);

  // ── sesler ────────────────────────────────────────────────────────────
  const rhodes = (t: number, n: number, vel: number, dur: number) => {
    const f = hz(n);
    const car = ctx.createOscillator(); car.type = "sine"; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.value = f;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 2.2, t); idx.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.35);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.9);
    g.gain.setValueAtTime(vel * 0.45, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    car.connect(g).connect(trem);
    car.start(t); mod.start(t); car.stop(t + dur + 0.4); mod.stop(t + dur + 0.4);
  };
  const bass = (t: number, n: number, dur: number, vel = 0.5) => {
    const f = hz(n);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650; lp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.28); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [type, mul] of [["triangle", 1], ["sine", 2]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.value = mul === 1 ? 1 : 0.25;
      o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
    lp.connect(g).connect(bassBus);
  };
  const noiseHit = (t: number, type: BiquadFilterType, freq: number, q: number, vel: number, decay: number, attack = 0.002) => {
    const s = ctx.createBufferSource(); s.buffer = white; s.playbackRate.value = rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f).connect(g).connect(drumBus);
    s.start(t, Math.random() * 1.5); s.stop(t + attack + decay + 0.05);
  };
  const ride = (t: number, vel: number) => { noiseHit(t, "bandpass", 7600, 1.2, vel, 0.45); noiseHit(t, "highpass", 10000, 0.7, vel * 0.5, 0.2); };
  const brush = (t: number, len: number, vel: number) => noiseHit(t, "bandpass", rnd(2200, 3200), 0.6, vel, len, len * 0.6); // fırça süpürmesi
  const slap = (t: number) => noiseHit(t, "bandpass", 1900, 0.9, 0.09, 0.14); // 2 ve 4'te fırça vuruşu
  const chick = (t: number) => noiseHit(t, "highpass", 7500, 0.8, 0.05, 0.05);
  const kick = (t: number, vel: number) => {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.3);
  };
  const vibes = (t: number, n: number, vel: number, dur: number) => {
    const f = hz(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, dur * 2.2));
    for (const [mul, a] of [[1, 1], [4, 0.12], [10, 0.03]] as const) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur * 2.2 + 0.7);
    }
    g.connect(vibesBus);
  };

  // kafe uğultusu (kahverengi gürültü, yavaş dalgalanan) + ara sıra fincan şıngırtısı
  const room = ctx.createBufferSource(); room.buffer = noiseBuf(ctx, 6, true); room.loop = true;
  const rlp = ctx.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 420;
  const rg = ctx.createGain(); rg.gain.value = 0.05;
  const rl = ctx.createOscillator(); rl.frequency.value = 0.07;
  const rla = ctx.createGain(); rla.gain.value = 0.02; rl.connect(rla).connect(rg.gain); rl.start();
  room.connect(rlp).connect(rg).connect(roomBus); room.start();
  const clink = () => {
    const t = ctx.currentTime + 0.05;
    for (const [f, a] of [[rnd(2600, 3400), 0.012], [rnd(4300, 5200), 0.007]] as const) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(roomBus); o.start(t); o.stop(t + 0.55);
    }
    timers.push(window.setTimeout(clink, rnd(18000, 45000)));
  };

  // ── zamanlayıcı (önden planlama) ─────────────────────────────────────
  const timers: number[] = [];
  const bpm = rnd(86, 96);
  const beat = 60 / bpm;
  const swing = beat * 0.66; // swing sekizliği: ikinci sekizlik geç gelir
  let next = ctx.currentTime + 0.2;
  let step = 0; // vuruş sayacı
  let lastBass = 41, lastMel = 72, soloChorus = false;

  const chordAt = (bar: number) => PROG[bar % PROG.length];
  const bassRoot = (pc: number) => { let n = 36 + pc; if (n > 45) n -= 12; return n; };
  const voicing = (pc: number, q: Q) => {
    let base = 48 + pc; if (base > 55) base -= 12;
    return QUAL[q].voice.map((i) => base + i).map((n) => (n > 72 ? n - 12 : n));
  };

  const scheduleBeat = (t: number, s: number) => {
    const bar = Math.floor(s / 4), b = s % 4;
    const [pc, q] = chordAt(bar);
    const [npc] = chordAt(bar + 1);
    if (b === 0 && bar % PROG.length === 0) soloChorus = Math.random() < 0.6;
    const late = () => rnd(-0.008, 0.012); // insan eli: mikro kayma

    // yürüyen bas
    let bn: number;
    if (b === 0) bn = bassRoot(pc);
    else if (b === 3) { const target = bassRoot(npc); bn = target + pick([-1, 1, 7 - 12]); }
    else { const tones = QUAL[q].tones.map((i) => bassRoot(pc) + i); bn = pick(tones.filter((n) => Math.abs(n - lastBass) <= 7)) ?? tones[1]; }
    lastBass = bn;
    bass(t + late(), bn, beat * 0.95, b === 0 ? 0.55 : 0.45);

    // davul: ride (1, 2, 2&, 3, 4, 4&), fırça, 2-4 vuruşları, yumuşak kick
    ride(t + late(), b % 2 === 0 ? 0.05 : 0.07);
    if (b % 2 === 1) { ride(t + swing + late(), 0.035); slap(t + late()); chick(t + late()); }
    brush(t, beat * 0.9, 0.018);
    if (b === 0 && Math.random() < 0.6) kick(t + late(), 0.12);
    if (Math.random() < 0.06) noiseHit(t + swing, "bandpass", 1800, 0.9, 0.04, 0.08); // ara sıra süs

    // piyano comping: ölçü başında desen seç (Charleston / 2&-4 / tutuşlu)
    if (b === 0) {
      const v = voicing(pc, q);
      const pattern = pick([[[0, 0], [1, 1]], [[1, 1], [3, 0]], [[0, 0]], [[0, 1], [2, 1]], [[1, 1], [2, 1]]]);
      for (const [pb, off] of pattern) {
        const st = t + pb * beat + (off ? swing : 0) + late();
        const dur = beat * rnd(0.6, 1.6);
        v.forEach((n, i) => rhodes(st + i * rnd(0, 0.008), n, rnd(0.035, 0.055), dur));
      }
    }

    // vibrafon melodisi (bazı turlarda, seyrek, akor dizisinde adım adım)
    if (soloChorus) {
      for (const off of [0, swing]) {
        if (Math.random() < (b === 0 && off === 0 ? 0.55 : 0.3)) {
          const sc = QUAL[q].scale.flatMap((i) => [60 + pc + i, 72 + pc + i, 84 + pc + i]).filter((n) => n >= 65 && n <= 84);
          const near = sc.filter((n) => Math.abs(n - lastMel) <= 4 && n !== lastMel);
          const n = near.length ? pick(near) : pick(sc);
          lastMel = n;
          vibes(t + off + late(), n, rnd(0.03, 0.05), beat * rnd(0.4, 1.2));
        }
      }
    }
  };

  const tick = () => {
    while (next < ctx.currentTime + 0.25) {
      scheduleBeat(next, step);
      next += beat; step++;
    }
  };
  const iv = window.setInterval(tick, 50);
  tick();
  timers.push(window.setTimeout(clink, rnd(8000, 20000)));
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
      clearInterval(iv);
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
