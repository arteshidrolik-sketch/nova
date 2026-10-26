"use client";

// Nova Stüdyo: RunPod pod'undaki modellere doğrudan erişim (arada Claude YOK → sansürsüz).
// Sohbet = pod'daki Ollama (Qwen2.5-Coder), Görsel = ComfyUI (Qwen-Image Uncensored).
// Nova sunucusu pod'a SSH köprüsüyle bağlanır; kullanıcı pod SSH bilgisini bir kez yapıştırır.
import { useEffect, useRef, useState } from "react";
import { IconBack } from "./UniverseIcons";

type Status = { configured: boolean; host: string; port: number; comfyUrl: string; tunnel: string; ollama: boolean; models: string[]; comfy: boolean };
type Msg = { role: "user" | "assistant"; content: string };

export default function Studio({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [tab, setTab] = useState<"baglan" | "sohbet">("baglan");
  const [sshText, setSshText] = useState("");
  const [comfyUrl, setComfyUrl] = useState("http://localhost:8188");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    try { const d = await fetch("/api/studio/connect").then((r) => r.json()); setSt(d); if (d.comfyUrl) setComfyUrl(d.comfyUrl); return d as Status; } catch { return null; }
  };
  useEffect(() => { refresh().then((d) => { if (d?.ollama) setTab("sohbet"); }); }, []);

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
    <div className="absolute inset-0 z-[80] flex flex-col" style={{ background: "linear-gradient(160deg,#0b0f20,#12152e 60%,#190f2b)" }}>
      {/* başlık */}
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--border-strong)", background: "var(--surface-header)" }}>
        <button onClick={onClose} className="flex h-11 items-center gap-1 rounded-full pl-2 pr-4 text-[14px]" style={{ border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}>
          <IconBack width={18} height={18} /> <span className="hidden sm:inline">Evren</span>
        </button>
        <div className="text-[18px] font-bold" style={{ background: "var(--grad)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Stüdyo</div>
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: connected ? "#2ff5b5" : "#ff7a7a" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: connected ? "#2ff5b5" : "#ff7a7a" }} />
          {connected ? "pod bağlı" : "pod bağlı değil"}
        </span>
        <div className="ml-auto flex gap-1.5">
          {(["baglan", "sohbet"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="rounded-lg px-3 py-1.5 text-[13px]" style={{ background: tab === t ? "var(--grad)" : "transparent", color: tab === t ? "#0b1030" : "var(--text-muted)", fontWeight: tab === t ? 700 : 500 }}>
              {t === "baglan" ? "Bağlan" : "Sohbet"}
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
              <a
                href={connected && st?.comfy ? (st.comfyUrl || comfyUrl) : undefined}
                target="_blank" rel="noreferrer"
                onClick={(e) => { if (!(connected && st?.comfy)) e.preventDefault(); }}
                className="flex flex-col items-center gap-2 rounded-2xl p-6 transition-colors"
                style={{ background: "var(--bg-panel)", border: `1px solid ${st?.comfy ? "var(--accent)" : "var(--border)"}`, opacity: st?.comfy ? 1 : 0.6 }}
              >
                <span className="text-[34px]">🎨</span>
                <span className="text-[15px] font-bold">Görsel</span>
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Qwen-Image · ComfyUI</span>
              </a>
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
        {tab === "sohbet" && <StudioChat models={st?.models ?? []} connected={connected} />}
      </main>
    </div>
  );
}

function StudioChat({ models, connected }: { models: string[]; connected: boolean }) {
  const [model, setModel] = useState(models[0] || "huihui_ai/qwen2.5-coder-abliterate:32b");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (models[0] && !models.includes(model)) setModel(models[0]); }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9 }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    try {
      const r = await fetch("/api/studio/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: next }) });
      if (!r.ok || !r.body) { const e = await r.json().catch(() => ({})); setMsgs([...next, { role: "assistant", content: `⚠️ ${e.error || "hata"}` }]); setBusy(false); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let acc = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setMsgs([...next, { role: "assistant", content: acc }]); }
    } catch { setMsgs([...next, { role: "assistant", content: "⚠️ bağlantı hatası" }]); }
    setBusy(false);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--border-strong)" }}>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Model:</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg px-2 py-1 text-[13px] outline-none" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}>
          {(models.length ? models : ["huihui_ai/qwen2.5-coder-abliterate:32b"]).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {msgs.length > 0 && <button onClick={() => setMsgs([])} className="ml-auto rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Temizle</button>}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
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
      <div className="border-t p-3 sm:p-4" style={{ borderColor: "var(--border-strong)" }}>
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Mesajını yaz… (sansürsüz, yerel model)"
            className="max-h-40 flex-1 resize-none rounded-xl px-3 py-2.5 text-[14px] outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
          />
          <button onClick={send} disabled={busy || !input.trim()} className="rounded-xl px-4 py-2.5 text-[14px] font-bold disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
            {busy ? "…" : "Gönder"}
          </button>
        </div>
      </div>
    </div>
  );
}
