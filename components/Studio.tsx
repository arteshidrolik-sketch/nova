"use client";

// Nova Stüdyo: RunPod pod'undaki modellere doğrudan erişim (arada Claude YOK → sansürsüz).
// Sohbet = pod'daki Ollama (Qwen2.5-Coder), Görsel = ComfyUI (Qwen-Image Uncensored).
// Nova sunucusu pod'a SSH köprüsüyle bağlanır; kullanıcı pod SSH bilgisini bir kez yapıştırır.
import { useEffect, useRef, useState } from "react";
import { IconBack } from "./UniverseIcons";
import { SKILLS } from "@/lib/studio/skills";

type Status = { configured: boolean; host: string; port: number; comfyUrl: string; tunnel: string; ollama: boolean; models: string[]; comfy: boolean };
type Msg = { role: "user" | "assistant"; content: string };

export default function Studio({ onClose }: { onClose: () => void }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  useEffect(() => { try { if (sessionStorage.getItem("nova:admin") === "1") setUnlocked(true); } catch { /* yoksay */ } }, []);
  // Şifre sunucuda doğrulanır (koda gömülü değil — depo herkese açık)
  const tryUnlock = async () => {
    try {
      const d = await fetch("/api/studio/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pw }) }).then((r) => r.json());
      if (d.ok) { setUnlocked(true); try { sessionStorage.setItem("nova:admin", "1"); } catch { /* yoksay */ } }
      else { setPwErr(true); setPw(""); }
    } catch { setPwErr(true); setPw(""); }
  };

  const [st, setSt] = useState<Status | null>(null);
  const [tab, setTab] = useState<"baglan" | "sohbet" | "gorsel" | "guvenlik" | "mufettis">("baglan");
  // Sohbet durumu üst bileşende tutulur → sekme değişince (StudioChat unmount) yazışma kaybolmaz
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatModel, setChatModel] = useState("huihui_ai/qwen2.5-coder-abliterate:32b");
  const [chatSkills, setChatSkills] = useState<string[]>(["hatasiz-kod", "debug", "dogrulama"]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const on = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  };
  const [sshText, setSshText] = useState("");
  const [comfyUrl, setComfyUrl] = useState("http://127.0.0.1:8188");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    try {
      const d = await fetch("/api/studio/connect").then((r) => r.json());
      setSt(d); if (d.comfyUrl) setComfyUrl(d.comfyUrl);
      // son kullanılan pod adresini kutuya doldur (boşsa) — her açılışta yeniden yapıştırma
      if (d.host && d.port) setSshText((cur) => cur || `ssh root@${d.host} -p ${d.port}`);
      return d as Status;
    } catch { return null; }
  };
  // açılışta pod durumunu al ama otomatik sekme değiştirme — kullanıcı sohbet/görsel seçsin
  // ayrıca diskteki sohbet hafızasını yükle (önceki konuşmayı hatırla)
  useEffect(() => {
    if (!unlocked) return;
    refresh();
    fetch("/api/studio/chat-history").then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.msgs) && d.msgs.length) setChatMsgs(d.msgs);
      if (Array.isArray(d?.skills) && d.skills.length) setChatSkills(d.skills);
    }).catch(() => { /* yoksay */ });
  }, [unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Şifre ekranı
  if (!unlocked) {
    return (
      <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center" style={{ background: "linear-gradient(160deg,#0b0f20,#12152e 60%,#190f2b)" }}>
        <button onClick={onClose} className="absolute left-4 top-4 flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}>
          <IconBack width={18} height={18} /> <span className="hidden sm:inline">Evren</span>
        </button>
        <div className="w-full max-w-xs rounded-2xl p-6 text-center" style={{ background: "var(--bg-panel)", border: "1px solid var(--border-strong)" }}>
          <div className="mb-1 text-[28px]">🔐</div>
          <div className="mb-4 text-[18px] font-bold">Admin</div>
          <input
            type="password" autoFocus value={pw}
            onChange={(e) => { setPw(e.target.value); setPwErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            placeholder="Şifre"
            className="mb-3 w-full rounded-xl px-3 py-2.5 text-center text-[16px] outline-none"
            style={{ background: "var(--bg)", border: `1px solid ${pwErr ? "#ff6b7a" : "var(--border-strong)"}`, color: "var(--text)" }}
          />
          {pwErr && <div className="mb-2 text-[13px]" style={{ color: "#ff6b7a" }}>Yanlış şifre</div>}
          <button onClick={tryUnlock} className="w-full rounded-xl py-2.5 text-[14px] font-bold" style={{ background: "var(--grad)", color: "#0b1030" }}>Gir</button>
        </div>
      </div>
    );
  }

  // "ssh root@IP -p PORT -i ..." ya da "IP:PORT" ya da "IP PORT" → {host, port}
  const parse = (s: string): { host: string; port: number } | null => {
    const m = s.match(/root@([\w.-]+).*?-p\s+(\d+)/) || s.match(/([\w.-]+)[:\s]+(\d+)/);
    if (!m) return null;
    return { host: m[1], port: Number(m[2]) };
  };

  const connect = async () => {
    const p = parse(sshText.trim());
    if (!p) { setErr("SSH satırını ya da IP:PORT yapıştır"); return; }
    setBusy(true); setErr("");
    try {
      const d = await fetch("/api/studio/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p, comfyUrl }) }).then((r) => r.json());
      if (d.error) { setErr(d.error); } else { await refresh(); if (d.ollama) setTab("sohbet"); }
    } catch { setErr("bağlanılamadı"); }
    setBusy(false);
  };

  const connected = !!st?.ollama;

  return (
    <div ref={rootRef} className="absolute inset-0 z-[80] flex flex-col" style={{ background: "linear-gradient(160deg,#0b0f20,#12152e 60%,#190f2b)" }}>
      {/* başlık */}
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--border-strong)", background: "var(--surface-header)" }}>
        <button onClick={onClose} className="flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}>
          <IconBack width={18} height={18} /> <span className="hidden sm:inline">Evren</span>
        </button>
        <div className="text-[18px] font-bold" style={{ background: "var(--grad)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Admin</div>
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: connected ? "#2ff5b5" : "#ff7a7a" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: connected ? "#2ff5b5" : "#ff7a7a" }} />
          {connected ? "pod bağlı" : "pod bağlı değil"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={toggleFs} title={isFs ? "Tam ekrandan çık" : "Tam ekran"} className="mr-1 h-9 w-9 rounded-lg text-[16px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}>
            {isFs ? "🗗" : "⛶"}
          </button>
          {([["baglan", "Bağlan"], ["sohbet", "💬 Sohbet"], ["gorsel", "🎨 Görsel"], ["guvenlik", "🎯 Güvenlik"], ["mufettis", "🕵️ Müfettiş"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className="rounded-lg px-3 py-1.5 text-[13px]" style={{ background: tab === t ? "var(--grad)" : "transparent", color: tab === t ? "#0b1030" : "var(--text-muted)", fontWeight: tab === t ? 700 : 500 }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {tab === "baglan" && (
          <div className="mx-auto max-w-2xl p-6 sm:p-10">
            {/* iki ikon */}
            <div className="mb-8 grid grid-cols-2 gap-4">
              <button
                onClick={() => connected ? setTab("sohbet") : null}
                className="flex flex-col items-center gap-2 rounded-2xl p-6 transition-colors"
                style={{ background: "var(--bg-panel)", border: `1px solid ${connected ? "var(--accent)" : "var(--border)"}`, opacity: connected ? 1 : 0.6 }}
              >
                <span className="text-[34px]">💬</span>
                <span className="text-[15px] font-bold">Sohbet</span>
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Qwen Coder · sansürsüz</span>
              </button>
              <button
                onClick={() => st?.comfy ? setTab("gorsel") : null}
                className="flex flex-col items-center gap-2 rounded-2xl p-6 transition-colors"
                style={{ background: "var(--bg-panel)", border: `1px solid ${st?.comfy ? "var(--accent)" : "var(--border)"}`, opacity: st?.comfy ? 1 : 0.6 }}
              >
                <span className="text-[34px]">🎨</span>
                <span className="text-[15px] font-bold">Görsel</span>
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Qwen-Image · sansürsüz</span>
              </button>
            </div>

            {/* bağlantı ayarı */}
            <div className="rounded-2xl p-5" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div className="mb-1 text-[15px] font-bold">Pod bağlantısı</div>
              <p className="mb-3 text-[13px]" style={{ color: "var(--text-muted)" }}>
                RunPod → pod → Connect → <b>SSH over exposed TCP</b> satırını yapıştır (pod her açıldığında adres değişir).
              </p>
              <input
                value={sshText} onChange={(e) => setSshText(e.target.value)}
                placeholder="ssh root@63.141.33.140 -p 22091 -i ~/.ssh/id_ed25519"
                className="mb-2 w-full rounded-lg px-3 py-2 font-mono text-[13px] outline-none"
                style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
              />
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>ComfyUI adresi:</span>
                <input
                  value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)}
                  className="flex-1 rounded-lg px-3 py-1.5 font-mono text-[12px] outline-none"
                  style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                />
              </div>
              <button onClick={connect} disabled={busy} className="rounded-lg px-4 py-2 text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
                {busy ? "Bağlanıyor…" : "Bağlan"}
              </button>
              {err && <span className="ml-3 text-[13px]" style={{ color: "#ff6b7a" }}>{err}</span>}
              {st && (
                <div className="mt-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  Köprü: {st.tunnel || "yok"} · Ollama: {st.ollama ? "✓" : "✗"} {st.models?.length ? `(${st.models.join(", ")})` : ""} · ComfyUI: {st.comfy ? "✓" : "✗"}
                </div>
              )}
              <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Not: ComfyUI&apos;yi tarayıcıda açmak için bu bilgisayarda tünel gerekir (localhost:8188) ya da RunPod&apos;da 8188 portunu açıp proxy adresini buraya yaz. Sohbet her yerden çalışır.
              </p>
            </div>
          </div>
        )}
        {tab === "sohbet" && <StudioChat models={st?.models ?? []} connected={connected} msgs={chatMsgs} setMsgs={setChatMsgs} input={chatInput} setInput={setChatInput} model={chatModel} setModel={setChatModel} skills={chatSkills} setSkills={setChatSkills} />}
        {tab === "gorsel" && <StudioImage connected={!!st?.comfy} />}
        {tab === "guvenlik" && <StudioSecurity connected={connected} />}
        {tab === "mufettis" && <StudioInspector />}
      </main>
    </div>
  );
}

// Görsel üretimi: prompt → Nova sunucusu ComfyUI'yi çalıştırır → görseli gösterir (tarayıcı pod'a bağlanmaz)
function StudioImage({ connected }: { connected: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<[number, number]>([1024, 1024]);
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [enhance, setEnhance] = useState(true); // prompt ajanı (Türkçe→detaylı İngilizce)
  const [used, setUsed] = useState(""); // ajanın ürettiği, modele giden prompt

  const run = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true); setErr(""); setImg(null); setUsed("");
    try {
      const d = await fetch("/api/studio/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p, width: size[0], height: size[1], enhance }) }).then((r) => r.json());
      if (d.image) { setImg(d.image); if (d.usedPrompt) setUsed(d.usedPrompt); } else setErr(d.error || "üretilemedi");
    } catch { setErr("bağlantı hatası"); }
    setBusy(false);
  };

  const sizes: [string, number, number][] = [["Kare 1024", 1024, 1024], ["Dikey 896×1152", 896, 1152], ["Yatay 1152×896", 1152, 896], ["Büyük 1328", 1328, 1328]];
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        {!connected && <div className="mb-4 rounded-xl p-4 text-[13px]" style={{ background: "var(--bg-panel)", border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}>Pod bağlı değil — önce &quot;Bağlan&quot; sekmesinden bağlan.</div>}
        <div className="mb-1 flex items-center gap-2">
          <label className="text-[14px] font-bold">Görsel tarifi (Türkçe yazabilirsin)</label>
          <button onClick={() => setEnhance((v) => !v)} title="Prompt ajanı: isteğini detaylı İngilizce prompt'a çevirir, model daha iyi izler" className="ml-auto rounded-lg px-2.5 py-1 text-[12px]" style={{ border: `1px solid ${enhance ? "var(--accent)" : "var(--border)"}`, background: enhance ? "var(--grad)" : "transparent", color: enhance ? "#0b1030" : "var(--text-muted)", fontWeight: enhance ? 700 : 500 }}>
            {enhance ? "✨ Prompt ajanı açık" : "Prompt ajanı kapalı"}
          </button>
        </div>
        <textarea
          value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); }}
          placeholder="an old Turkish fisherman at golden hour on an Istanbul pier, cinematic, ultra detailed"
          className="mb-3 w-full resize-none rounded-xl p-3 text-[14px] outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {sizes.map(([lbl, w, h]) => (
            <button key={lbl} onClick={() => setSize([w, h])} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ border: `1px solid ${size[0] === w && size[1] === h ? "var(--accent)" : "var(--border)"}`, color: size[0] === w && size[1] === h ? "var(--text)" : "var(--text-muted)" }}>{lbl}</button>
          ))}
          <button onClick={run} disabled={busy || !prompt.trim() || !connected} className="ml-auto rounded-xl px-5 py-2 text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
            {busy ? "Üretiliyor…" : "Üret"}
          </button>
        </div>
        {err && <div className="mb-3 text-[13px]" style={{ color: "#ff6b7a" }}>⚠ {err}</div>}
        {busy && <div className="flex h-80 items-center justify-center rounded-2xl text-[13px]" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>Görsel hazırlanıyor… (pod kapalıysa önce ~3 dk uyanır, sonraki görseller hızlı)</div>}
        {img && !busy && (
          <div className="rounded-2xl p-2" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="üretilen görsel" className="w-full rounded-xl" />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button onClick={run} className="rounded-lg px-3 py-1.5 text-[13px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>↻ Yeniden üret</button>
              <a href={img} download="nova-gorsel.png" className="rounded-lg px-3 py-1.5 text-[13px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>İndir</a>
            </div>
          </div>
        )}
        {used && !busy && (
          <details className="mt-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <summary className="cursor-pointer">Modele giden İngilizce prompt (ajan yazdı)</summary>
            <div className="mt-1.5 whitespace-pre-wrap rounded-lg p-2.5" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)" }}>{used}</div>
          </details>
        )}
      </div>
    </div>
  );
}

// Akıcı Matrix yağmuru (canvas + rAF + delta-zaman → kare atlamaz, iz sürekli solar).
function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const CH = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンﾊﾋ0123456789ﾘﾂABCDEF".split("");
    const FONT = 16;
    let w = 0, h = 0, dpr = 1, cols = 0;
    let y: number[] = [], spd: number[] = [], cur: string[] = [], cell: number[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    const setup = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT}px "Courier New", monospace`;
      ctx.textBaseline = "top";
      cols = Math.ceil(w / FONT);
      y = Array.from({ length: cols }, () => rnd(-h, 0));
      spd = Array.from({ length: cols }, () => rnd(55, 135)); // px/sn
      cur = Array.from({ length: cols }, () => CH[(Math.random() * CH.length) | 0]);
      cell = y.map((v) => Math.floor(v / FONT));
      ctx.clearRect(0, 0, w, h);
    };
    setup();

    let last = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.05) dt = 0.05; // sekme arka plandan dönünce zıplamasın

      // iz solması — kare hızından bağımsız (tau ~0.55sn), sürekli ve pürüzsüz
      ctx.fillStyle = `rgba(6,10,18,${Math.min(0.5, dt / 0.55)})`;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < cols; i++) {
        y[i] += spd[i] * dt;
        const c = Math.floor(y[i] / FONT);
        if (c !== cell[i]) { cur[i] = CH[(Math.random() * CH.length) | 0]; cell[i] = c; } // hücre değişince yeni karakter
        const x = i * FONT;
        const yy = c * FONT;
        ctx.fillStyle = "#0aff8c"; // parlak baş
        ctx.fillText(cur[i], x, yy);
        ctx.fillStyle = "rgba(10,255,140,0.35)"; // bir arkadaki soluk iz
        ctx.fillText(cur[i], x, yy - FONT);
        if (y[i] > h + rnd(0, h * 0.4)) { y[i] = rnd(-FONT * 6, 0); spd[i] = rnd(55, 135); cell[i] = Math.floor(y[i] / FONT); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    let rt: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(setup, 150); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); clearTimeout(rt); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 0, opacity: 0.3 }} aria-hidden />;
}

// Müfettiş paneli: ekip ajanlarının OPERASYON performans skorları + sert verdiktler.
type IDims = { hiz: number; teslim: number; verim: number; disiplin: number; ilgililik: number | null };
type IScore = { role: string; person: string; runs: number; avg: number; dims: IDims; pending: number };
type IVerdict = { id: string; ts: number; role: string; person: string; tier: string; task: string; metrics: { sec: number; output: number; errors: number; artifacts: number; failed: boolean }; dims: IDims; total: number; judged: boolean; verdikt?: string };

const scoreColor = (n: number) => (n >= 80 ? "#2ff5b5" : n >= 50 ? "#ffcf5c" : "#ff7a7a");
const ROLE_TR: Record<string, string> = { research: "Araştırma", coder: "Yazılım", marketing: "Pazarlama" };

// 🎯 Güvenlik: hedef ver → "Saldır" → pod'daki Qwen açıkları bulup ele geçirmeye çalışır.
// Kapsam kilidi (yalnız Yücel'in kendi varlıkları) sunucuda zorlanır.
function StudioSecurity({ connected }: { connected: boolean }) {
  const [target, setTarget] = useState("");
  const [level, setLevel] = useState<"kesif" | "saldiri">("kesif");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<{ hosts: string[]; ips: string[] } | null>(null);
  const [reports, setReports] = useState<{ name: string; ts: number }[]>([]);
  const [viewer, setViewer] = useState<{ name: string; content: string } | null>(null);
  const [showScope, setShowScope] = useState(false);
  const [scopeEdit, setScopeEdit] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = () => fetch("/api/security").then((r) => r.json()).then((d) => {
    if (d.scope) { setScope(d.scope); setScopeEdit([...(d.scope.hosts || []), ...(d.scope.ips || [])].join("\n")); }
    if (Array.isArray(d.reports)) setReports(d.reports);
  }).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }); }, [log]);

  const attack = async () => {
    const t = target.trim();
    if (!t || busy) return;
    setBusy(true); setLog(""); setViewer(null);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const r = await fetch("/api/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: t, level }), signal: ac.signal });
      if (!r.ok || !r.body) { const e = await r.json().catch(() => ({})); setLog(`⚠️ ${e.error || "hata"}`); setBusy(false); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setLog(acc); }
      load(); // yeni rapor listeye düşsün
    } catch (e) { if ((e as Error).name !== "AbortError") setLog((l) => l + `\n⚠️ bağlantı hatası`); }
    setBusy(false);
  };
  const stop = () => { abortRef.current?.abort(); setBusy(false); };

  const saveScope = async () => {
    const lines = scopeEdit.split("\n").map((s) => s.trim()).filter(Boolean);
    const ips = lines.filter((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l));
    const hosts = lines.filter((l) => !ips.includes(l));
    const d = await fetch("/api/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: { hosts, ips } }) }).then((r) => r.json()).catch(() => null);
    if (d?.scope) { setScope(d.scope); setShowScope(false); }
  };
  const openReport = (name: string) => fetch(`/api/security?report=${encodeURIComponent(name)}`).then((r) => r.json()).then((d) => { if (d.content) setViewer({ name: d.name, content: d.content }); }).catch(() => {});

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border-strong)", background: "var(--bg-panel)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") attack(); }}
            placeholder="https://getdriver.com.tr  (yalnız kendi varlıkların)" disabled={busy}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[14px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          <select value={level} onChange={(e) => setLevel(e.target.value as "kesif" | "saldiri")} disabled={busy}
            className="rounded-lg px-2 py-2 text-[13px] outline-none" style={{ background: "var(--bg)", border: `1px solid ${level === "saldiri" ? "#ff7a7a" : "var(--border)"}`, color: level === "saldiri" ? "#ff7a7a" : "var(--text)" }}>
            <option value="kesif">🔍 Keşif (zararsız)</option>
            <option value="saldiri">⚔️ Saldırı (sömürü)</option>
          </select>
          {busy
            ? <button onClick={stop} className="rounded-lg px-4 py-2 text-[14px] font-bold" style={{ background: "#ff7a7a", color: "#0b1030" }}>⏹ Durdur</button>
            : <button onClick={attack} disabled={!connected || !target.trim()} className="rounded-lg px-4 py-2 text-[14px] font-bold" style={{ background: connected && target.trim() ? "var(--grad)" : "var(--border)", color: "#0b1030", opacity: connected && target.trim() ? 1 : 0.5 }}>Saldır ▶</button>}
          <button onClick={() => setShowScope((v) => !v)} className="rounded-lg border px-2 py-2 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>🔒 Kapsam</button>
        </div>
        {!connected && <div className="text-[12px]" style={{ color: "#ffcf5c" }}>Pod bağlı değil — ilk &quot;Saldır&quot;da otomatik başlar (~2-3 dk soğuk başlatma).</div>}
        {level === "saldiri" && <div className="text-[12px]" style={{ color: "#ff9a7a" }}>⚠️ Saldırı modu veriyi değiştirebilir/sistemi bozabilir. Canlı yerine kopya/staging hedefle, önce yedek al.</div>}
        {scope && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>İzinli: {scope.hosts.join(", ")}{scope.ips.length ? ` · ${scope.ips.join(", ")}` : ""}</div>}
        {showScope && (
          <div className="rounded-lg p-3" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <div className="mb-1 text-[12px]" style={{ color: "var(--text-muted)" }}>İzinli hedefler (her satıra bir alan adı ya da IP). Ajan yalnız bunlara saldırabilir:</div>
            <textarea value={scopeEdit} onChange={(e) => setScopeEdit(e.target.value)} rows={4} className="w-full rounded-lg px-2 py-1.5 text-[13px] outline-none" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "monospace" }} />
            <button onClick={saveScope} className="mt-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: "var(--grad)", color: "#0b1030" }}>Kaydet</button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" style={{ display: "grid", gridTemplateColumns: viewer ? "1fr 1fr" : "1fr" }}>
        <div ref={logRef} className="min-h-0 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed" style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", color: "var(--text)" }}>
          {log || <span style={{ color: "var(--text-muted)" }}>Hedef adresi gir, modu seç, Saldır&apos;a bas. Ajan keşiften başlar, açık buldukça canlı raporlar; sonunda tam rapor kaydedilir.{"\n\n"}Son raporlar:{"\n"}{reports.length === 0 ? "  (henüz yok)" : reports.map((r) => `  • ${r.name}`).join("\n")}</span>}
          {!busy && reports.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {reports.slice(0, 8).map((r) => <button key={r.name} onClick={() => openReport(r.name)} className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>📄 {r.name.slice(0, 28)}</button>)}
            </div>
          )}
        </div>
        {viewer && (
          <div className="min-h-0 overflow-y-auto border-l px-4 py-3" style={{ borderColor: "var(--border-strong)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold">{viewer.name}</span>
              <button onClick={() => setViewer(null)} className="text-[12px]" style={{ color: "var(--text-muted)" }}>✕ kapat</button>
            </div>
            <div className="text-[12.5px] leading-relaxed" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", color: "var(--text)" }}>{viewer.content}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudioInspector() {
  const [sb, setSb] = useState<IScore[]>([]);
  const [recent, setRecent] = useState<IVerdict[]>([]);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const d = await fetch("/api/inspector").then((r) => r.json());
      setSb(d.scoreboard ?? []); setRecent(d.recent ?? []); setPending(d.pending ?? 0);
    } catch { /* yoksay */ }
  };
  useEffect(() => { load(); }, []);

  const run = async () => {
    setBusy(true); setMsg("Müfettiş çalışıyor… (pod kapalıysa önce ~3 dk uyanır)");
    try {
      const d = await fetch("/api/inspector", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) }).then((r) => r.json());
      setMsg(d.reason ? `⚠ ${d.reason}` : `${d.processed} koşum denetlendi${d.pending ? `, ${d.pending} bekliyor` : ""}.`);
      await load();
    } catch { setMsg("⚠ bağlantı hatası"); }
    setBusy(false);
  };

  const bar = (label: string, n: number | null) => (
    <div className="flex items-center gap-1.5" title={label}>
      <span className="w-[52px] text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      {n === null ? <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>—</span> : (
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
          <div className="h-full rounded-full" style={{ width: `${n}%`, background: scoreColor(n) }} />
        </div>
      )}
    </div>
  );

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="text-[18px] font-bold">🕵️ Müfettiş</div>
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>ekip ajanlarının operasyon performansı</span>
          <button onClick={run} disabled={busy} className="ml-auto rounded-lg px-3 py-1.5 text-[13px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
            {busy ? "Çalışıyor…" : `Müfettişi çalıştır${pending ? ` (${pending})` : ""}`}
          </button>
        </div>
        {msg && <div className="mb-3 text-[12px]" style={{ color: "var(--text-muted)" }}>{msg}</div>}
        <p className="mb-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
          Sert metrikler (hız, teslim, verim, disiplin) her koşumda otomatik. İlgililik + sert verdikt yerel sansürsüz modelden — &quot;Müfettişi çalıştır&quot; ile işlenir. İş doğruluğunu müdür denetler, müfettiş yalnız performansa bakar.
        </p>

        {!sb.length && <div className="rounded-xl p-5 text-center text-[13px]" style={{ background: "var(--bg-panel)", border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}>Henüz denetlenecek koşum yok. Ekip bir görev çalıştırınca burada belirir.</div>}

        {/* skor tablosu */}
        <div className="mb-6 flex flex-col gap-2">
          {sb.map((a) => (
            <div key={a.role} className="rounded-xl p-3" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div className="mb-2 flex items-center gap-3">
                <span className="text-[15px] font-bold">{a.person}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{ROLE_TR[a.role] ?? a.role} · {a.runs} koşum{a.pending ? ` · ${a.pending} denetlenmedi` : ""}</span>
                <span className="ml-auto text-[22px] font-bold" style={{ color: scoreColor(a.avg) }}>{a.avg}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {bar("Hız", a.dims.hiz)}{bar("Teslim", a.dims.teslim)}{bar("İlgililik", a.dims.ilgililik)}{bar("Verim", a.dims.verim)}{bar("Disiplin", a.dims.disiplin)}
              </div>
            </div>
          ))}
        </div>

        {/* son verdiktler */}
        {recent.length > 0 && <div className="mb-2 text-[13px] font-bold">Son denetimler</div>}
        <div className="flex flex-col gap-2">
          {recent.map((v) => (
            <div key={v.id} className="rounded-xl p-3" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-bold">{v.person}</span>
                <span style={{ color: "var(--text-muted)" }}>{v.metrics.sec}sn · {v.metrics.output} tk{v.metrics.errors ? ` · ${v.metrics.errors} hata` : ""}{v.metrics.failed ? " · BOŞ" : ""}</span>
                <span className="ml-auto text-[16px] font-bold" style={{ color: scoreColor(v.total) }}>{v.total}</span>
              </div>
              <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{v.task}</div>
              {v.verdikt ? <div className="mt-1.5 text-[13px]" style={{ color: "var(--text)" }}>💢 {v.verdikt}</div>
                : <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>⏳ model denetimi bekliyor (sert metrik hazır)</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StudioChat({ models, connected, msgs, setMsgs, input, setInput, model, setModel, skills, setSkills }: {
  models: string[]; connected: boolean;
  msgs: Msg[]; setMsgs: React.Dispatch<React.SetStateAction<Msg[]>>;
  input: string; setInput: (v: string) => void;
  model: string; setModel: (v: string) => void;
  skills: string[]; setSkills: (v: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [atts, setAtts] = useState<string[]>([]); // ekli görseller (resim ya da video kareleri, dataURL)
  const [attLabel, setAttLabel] = useState(""); // "2 resim" / "video: 5 kare"
  const [listening, setListening] = useState(false); // mikrofon açık mı
  const [speak, setSpeak] = useState(false); // cevabı sesli oku
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (models[0] && !models.includes(model)) setModel(models[0]); }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9 }); }, [msgs]);
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* yoksay */ } }, []);

  // Sesli giriş (tarayıcı SpeechRecognition — Chrome/Edge). DOM tipinde garanti olmadığı için yerel arayüz.
  const toggleMic = () => {
    type Rec = {
      lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
    };
    const win = window as unknown as { webkitSpeechRecognition?: new () => Rec; SpeechRecognition?: new () => Rec };
    const Ctor = win.webkitSpeechRecognition || win.SpeechRecognition;
    if (!Ctor) { alert("Tarayıcın sesli girişi desteklemiyor (Chrome/Edge kullan)."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new Ctor();
    r.lang = "tr-TR"; r.interimResults = true; r.continuous = true;
    const base = input ? input + " " : "";
    r.onresult = (e) => {
      let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput((base + t).trimStart());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); r.start();
  };

  // Cevabı sesli oku
  const sayOut = (text: string) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, "").slice(0, 4000));
      u.lang = "tr-TR"; window.speechSynthesis.speak(u);
    } catch { /* yoksay */ }
  };

  // Resim ekle (dataURL)
  const addImages = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 8).forEach((f) => {
      const rd = new FileReader();
      rd.onload = () => { setAtts((p) => [...p, String(rd.result)].slice(0, 8)); setAttLabel(""); };
      rd.readAsDataURL(f);
    });
  };

  // Video → birkaç kare örnekle (tarayıcıda; küçült → JPEG). Kareler resim gibi modele gider.
  const addVideo = async (file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const v = document.createElement("video");
      v.src = url; v.muted = true; v.preload = "auto";
      await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("video okunamadı")); });
      const dur = v.duration || 0;
      const N = Math.min(6, Math.max(3, Math.floor(dur / 3) || 3));
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const frames: string[] = [];
      for (let i = 0; i < N; i++) {
        const t = dur * (i + 0.5) / N;
        await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = t; });
        const scale = Math.min(1, 768 / Math.max(1, v.videoWidth));
        canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
        ctx?.drawImage(v, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.7));
      }
      setAtts(frames.slice(0, 8)); setAttLabel(`video: ${frames.length} kare`);
    } catch { alert("Video karelere ayrılamadı."); }
    finally { URL.revokeObjectURL(url); }
  };

  // Hafızaya yaz (yazışma + seçili beceriler) — sunucuda diskte tutulur
  const save = (m: Msg[], sk: string[]) => {
    fetch("/api/studio/chat-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msgs: m, skills: sk }) }).catch(() => { /* yoksay */ });
  };
  const toggleSkill = (id: string) => {
    const next = skills.includes(id) ? skills.filter((s) => s !== id) : [...skills, id];
    setSkills(next); save(msgs, next);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !atts.length) || busy) return;
    if (listening) recRef.current?.stop();
    const images = atts;
    const shown = text + (images.length ? ` [${attLabel || `${images.length} görsel`}]` : "");
    setInput(""); setAtts([]); setAttLabel(""); setBusy(true);
    const next: Msg[] = [...msgs, { role: "user", content: text || "Bu görseli ayrıntılı anlat." }];
    const shownMsgs: Msg[] = [...msgs, { role: "user", content: shown || "Bu görseli ayrıntılı anlat." }];
    setMsgs([...shownMsgs, { role: "assistant", content: "" }]);
    try {
      const r = await fetch("/api/studio/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: next, skills, images }) });
      if (!r.ok || !r.body) { const e = await r.json().catch(() => ({})); const done: Msg[] = [...shownMsgs, { role: "assistant", content: `⚠️ ${e.error || "hata"}` }]; setMsgs(done); save(done, skills); setBusy(false); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setMsgs([...shownMsgs, { role: "assistant", content: acc }]); }
      save([...shownMsgs, { role: "assistant", content: acc }], skills);
      if (speak && acc.trim()) sayOut(acc);
    } catch { const done: Msg[] = [...shownMsgs, { role: "assistant", content: "⚠️ bağlantı hatası" }]; setMsgs(done); save(done, skills); }
    setBusy(false);
  };

  const clear = () => { setMsgs([]); save([], skills); };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <MatrixRain />
      <div className="relative z-10 flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--border-strong)", background: "rgba(8,12,22,0.55)", backdropFilter: "blur(2px)" }}>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Model:</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg px-2 py-1 text-[13px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}>
          {(models.length ? models : ["huihui_ai/qwen2.5-coder-abliterate:32b"]).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => setShowSkills((v) => !v)} className="rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: showSkills ? "var(--accent)" : "var(--border)", color: "var(--text-muted)" }}>
          ⚙️ Beceriler{skills.length ? ` (${skills.length})` : ""}
        </button>
        {msgs.length > 0 && <button onClick={clear} className="ml-auto rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Temizle</button>}
      </div>
      {showSkills && (
        <div className="relative z-10 border-b px-4 py-3" style={{ borderColor: "var(--border-strong)", background: "var(--bg-panel)" }}>
          <div className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>Seçili beceriler sistem talimatı olarak modele yüklenir (kodlama tarzını belirler):</div>
          <div className="flex flex-wrap gap-2">
            {SKILLS.map((s) => {
              const on = skills.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggleSkill(s.id)} title={s.desc} className="rounded-lg px-2.5 py-1.5 text-left text-[12px]" style={{ border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--grad)" : "transparent", color: on ? "#0b1030" : "var(--text-muted)" }}>
                  {on ? "✓ " : ""}{s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div ref={scrollRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {!connected && <div className="rounded-xl p-4 text-[13px]" style={{ background: "var(--bg-panel)", border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}>Pod bağlı değil — önce &quot;Bağlan&quot; sekmesinden bağlan.</div>}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end" : "self-start"} style={{ maxWidth: "85%" }}>
              <div className="whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed" style={{ background: m.role === "user" ? "var(--grad)" : "var(--bg-panel)", color: m.role === "user" ? "#0b1030" : "var(--text)", border: m.role === "user" ? "none" : "1px solid var(--border)" }}>
                {m.content || "…"}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-10 border-t p-3 sm:p-4" style={{ borderColor: "var(--border-strong)", background: "rgba(8,12,22,0.55)", backdropFilter: "blur(2px)" }}>
        <div className="mx-auto max-w-3xl">
          {/* ekli görsel önizleme */}
          {atts.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{attLabel || `${atts.length} görsel`} eklendi</span>
              {atts.slice(0, 8).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" className="h-10 w-10 rounded-md object-cover" style={{ border: "1px solid var(--border)" }} />
              ))}
              <button onClick={() => { setAtts([]); setAttLabel(""); }} className="text-[12px]" style={{ color: "#ff8a8a" }}>kaldır</button>
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* araç ikonları */}
            <div className="flex gap-1">
              <button onClick={toggleMic} title="Sesli giriş" className="h-10 w-10 rounded-xl text-[17px]" style={{ border: `1px solid ${listening ? "#ff6b7a" : "var(--border-strong)"}`, background: listening ? "rgba(255,107,122,0.15)" : "transparent", color: "var(--text)" }}>🎤</button>
              <button onClick={() => { setSpeak((s) => { if (s) try { window.speechSynthesis.cancel(); } catch { /* yoksay */ } return !s; }); }} title="Cevabı sesli oku" className="h-10 w-10 rounded-xl text-[17px]" style={{ border: `1px solid ${speak ? "var(--accent)" : "var(--border-strong)"}`, background: speak ? "rgba(79,209,197,0.15)" : "transparent", color: "var(--text)" }}>🔊</button>
              <button onClick={() => imgRef.current?.click()} title="Resim ekle" className="h-10 w-10 rounded-xl text-[17px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>🖼️</button>
              <button onClick={() => vidRef.current?.click()} title="Video ekle (kareler modele gider)" className="h-10 w-10 rounded-xl text-[17px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>🎬</button>
              <input ref={imgRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
              <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { addVideo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </div>
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={listening ? "Dinliyorum…" : "Mesajını yaz ya da 🎤 ile konuş…"}
              className="max-h-40 flex-1 resize-none rounded-xl px-3 py-2.5 text-[14px] outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
            />
            <button onClick={send} disabled={busy || (!input.trim() && !atts.length)} className="rounded-xl px-4 py-2.5 text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
              {busy ? "…" : "Gönder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
