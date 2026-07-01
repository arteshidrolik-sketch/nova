"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AGENT_META,
  isAgentKey,
  type AgentActivity,
  type AgentKey,
} from "@/lib/agents/meta";

type Attachment = {
  kind: "image" | "pdf" | "text";
  name: string;
  mediaType?: string;
  data?: string; // base64 (image/pdf)
  text?: string; // metin dosyaları
  previewUrl?: string; // görsel önizleme (yalnız oturum)
};

type Message = {
  role: "user" | "assistant";
  content: string;
  agent?: AgentKey;
  attachments?: Attachment[];
};

function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function readAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsText(file);
  });
}

// --- Web Speech API (tarayıcıya özel) minimal tipler ---
type SpeechResult = { 0: { transcript: string }; isFinal: boolean };
type SpeechEvent = { results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: SpeechEvent) => void;
  onend: () => void;
  onerror: (e: { error?: string }) => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function Typing() {
  return (
    <span className="typing">
      <span />
      <span />
      <span />
    </span>
  );
}

function AgentBadge({ agent }: { agent: AgentKey }) {
  const meta = AGENT_META[agent];
  return (
    <span
      className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: meta.color,
        background: `${meta.color}1a`,
        border: `1px solid ${meta.color}40`,
      }}
    >
      <span>{meta.emoji}</span>
      {meta.label}
    </span>
  );
}

export type ChatHandle = {
  startListening: () => void;
  toggleWake: () => void;
};

type ChatProps = {
  onAgentActivity?: (a: AgentActivity) => void;
  conversationId?: string | null;
  onConversationUpdated?: () => void;
  onVoiceState?: (s: "idle" | "listening" | "speaking") => void;
  onWakeState?: (enabled: boolean) => void;
  onBusy?: (busy: boolean) => void;
};

const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(
  {
    onAgentActivity,
    conversationId,
    onConversationUpdated,
    onVoiceState,
    onWakeState,
    onBusy,
  },
  ref,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voices, setVoices] = useState<
    { uri: string; name: string; lang: string }[]
  >([]);
  const [voiceURI, setVoiceURI] = useState("");
  const voiceURIRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const speakRef = useRef(false);
  const voiceReplyRef = useRef(false); // sesle sorulduysa cevabı her zaman seslendir
  const wakeRef = useRef<Recognition | null>(null); // "Nova" wake-word dinleyici
  const wakeOnRef = useRef(false);

  useEffect(() => {
    setVoiceSupported(!!getRecognitionCtor());
  }, []);

  // Sesleri yükle + kadın Türkçe sesi otomatik seç
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const list = window.speechSynthesis
        .getVoices()
        .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
      if (!list.length) return;
      setVoices(list);
      const saved = localStorage.getItem("nova_voice") || "";
      if (saved && list.some((v) => v.uri === saved)) {
        setVoiceURI(saved);
        return;
      }
      const tr = list.filter((v) => v.lang.toLowerCase().startsWith("tr"));
      const femaleKw = ["emel", "filiz", "yelda", "seda", "aysel", "zeynep", "female", "kad"];
      const pick =
        tr.find((v) => femaleKw.some((k) => v.name.toLowerCase().includes(k))) ||
        tr.find((v) => v.name.toLowerCase().includes("google")) ||
        tr[0] ||
        list.find((v) => femaleKw.some((k) => v.name.toLowerCase().includes(k)));
      if (pick) setVoiceURI(pick.uri);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);
  useEffect(() => {
    voiceURIRef.current = voiceURI;
  }, [voiceURI]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    speakRef.current = speakEnabled;
  }, [speakEnabled]);
  useEffect(() => {
    onVoiceState?.(listening ? "listening" : speaking ? "speaking" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, speaking]);

  // "Meşgul" sinyali: yazışma akarken / ses varken tam ekran ekran-koruyucu devreye girmesin
  useEffect(() => {
    onBusy?.(loading || listening || speaking);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listening, speaking]);

  // Aktif sohbet değişince mesajları yükle
  useEffect(() => {
    onAgentActivity?.(null);
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/conversations/${conversationId}`);
        const d = await r.json();
        if (!cancelled)
          setMessages((d.conversation?.messages ?? []) as Message[]);
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function persist(msgs: Message[]) {
    if (!conversationId) return;
    // Ekleri hafifet (base64 veri saklama, sadece ad/tür)
    const light = msgs.map((m) =>
      m.attachments
        ? {
            ...m,
            attachments: m.attachments.map((a) => ({
              kind: a.kind,
              name: a.name,
            })),
          }
        : m,
    );
    fetch(`/api/conversations/${conversationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: light }),
    })
      .then(() => onConversationUpdated?.())
      .catch(() => {});
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const out: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 8 * 1024 * 1024) {
        alert(`${file.name} çok büyük (en fazla 8 MB).`);
        continue;
      }
      if (file.type.startsWith("image/")) {
        const url = await readAsDataURL(file);
        out.push({
          kind: "image",
          name: file.name,
          mediaType: file.type,
          data: url.split(",")[1],
          previewUrl: url,
        });
      } else if (file.type === "application/pdf") {
        const url = await readAsDataURL(file);
        out.push({ kind: "pdf", name: file.name, data: url.split(",")[1] });
      } else if (/\.(docx|xlsx|xls)$/i.test(file.name)) {
        // Office → sunucuda metne çevir
        try {
          const url = await readAsDataURL(file);
          const b64 = url.split(",")[1];
          const r = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, data: b64 }),
          });
          const d = await r.json();
          if (r.ok && d.text) {
            out.push({
              kind: "text",
              name: file.name,
              text: String(d.text).slice(0, 150000),
            });
          } else {
            alert(`${file.name} okunamadı: ${d?.error ?? "hata"}`);
          }
        } catch {
          alert(`${file.name} işlenemedi.`);
        }
      } else if (
        file.type.startsWith("text/") ||
        /\.(txt|md|json|csv|ts|tsx|js|jsx|css|html|py|java|kt|swift|go|rs)$/i.test(
          file.name,
        )
      ) {
        const text = await readAsText(file);
        out.push({ kind: "text", name: file.name, text: text.slice(0, 100000) });
      } else {
        alert(`Desteklenmeyen dosya: ${file.name}`);
      }
    }
    if (out.length) setAttachments((a) => [...a, ...out]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = text
      .replace(/[#*`_>~|]/g, " ")
      .replace(/\p{Extended_Pictographic}/gu, "") // emojileri okuma
      .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{2,}/g, ". ")
      .trim();
    const u = new SpeechSynthesisUtterance(clean);
    const chosen = window.speechSynthesis
      .getVoices()
      .find((v) => v.voiceURI === voiceURIRef.current);
    if (chosen) {
      u.voice = chosen;
      u.lang = chosen.lang;
    } else {
      u.lang = "tr-TR";
    }
    u.onstart = () => setSpeaking(true);
    u.onend = () => {
      setSpeaking(false);
      resumeWake(); // TTS bitince wake'e geri dön (kendi sesini duymaz)
    };
    u.onerror = () => {
      setSpeaking(false);
      resumeWake();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* yoksay */
    }
  }

  function startListening() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      alert(
        "Sesli giriş güvenli bağlam ister. Adres çubuğunda http://localhost:3000 kullan (ağ IP'siyle değil).",
      );
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      alert(
        "Tarayıcın sesli girişi desteklemiyor. Chrome veya Edge kullan (Firefox/Safari kısıtlı).",
      );
      return;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    // wake dinleyiciyi ve eski komut oturumunu kapat (mikrofon serbest kalsın)
    try {
      wakeRef.current?.abort();
    } catch {
      /* yoksay */
    }
    wakeRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* yoksay */
    }
    try {
      const rec = new Ctor();
      rec.lang = "tr-TR";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let t = "";
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          t += e.results[i][0].transcript;
          if (e.results[i].isFinal) final = true;
        }
        setInput(t);
        if (final && t.trim()) {
          try {
            rec.stop();
          } catch {
            /* yoksay */
          }
          setInput("");
          voiceReplyRef.current = true;
          send(t);
        }
      };
      rec.onend = () => {
        if (recognitionRef.current === rec) {
          setListening(false);
          recognitionRef.current = null;
          resumeWake(); // wake'e geri dön (konuşma bitince)
        }
      };
      rec.onerror = (e) => {
        const isCurrent = recognitionRef.current === rec;
        if (isCurrent) {
          setListening(false);
          recognitionRef.current = null;
        }
        const code = e?.error || "bilinmeyen";
        if (!isCurrent || code === "aborted" || code === "no-speech") return;
        const msg =
          code === "not-allowed" || code === "service-not-allowed"
            ? "Mikrofon izni reddedildi. Adres çubuğundaki 🔒 / kamera simgesinden mikrofona izin ver."
            : code === "audio-capture"
              ? "Mikrofon bulunamadı. Cihaz bağlı mı?"
              : code === "network"
                ? "Ağ hatası — sesli tanıma çevrimiçi çalışır, interneti kontrol et."
                : `Sesli giriş hatası: ${code}`;
        alert(msg);
      };
      recognitionRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  function toggleMic() {
    if (listening) stopListening();
    else startListening();
  }

  function pauseWake() {
    try {
      wakeRef.current?.abort();
    } catch {
      /* yoksay */
    }
    wakeRef.current = null;
  }

  function resumeWake() {
    if (!wakeOnRef.current || recognitionRef.current || wakeRef.current) return;
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) return;
    setTimeout(runWake, 300);
  }

  // --- "Nova" wake-word: sürekli dinler; "Nova ... komut"u tek nefeste yakalar ---
  function runWake() {
    if (!wakeOnRef.current || recognitionRef.current || wakeRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const w = new Ctor();
      w.lang = "tr-TR";
      w.interimResults = false;
      w.continuous = true;
      w.onresult = (e) => {
        let finalText = "";
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
        }
        const lower = finalText.toLowerCase();
        const idx = lower.lastIndexOf("nova");
        if (idx === -1) return;
        const cmd = finalText
          .slice(idx + 4)
          .replace(/^[\s,.;:!?-]+/, "")
          .trim();
        pauseWake();
        if (cmd.length >= 2) {
          voiceReplyRef.current = true;
          send(cmd); // "Nova <komut>" — tek seferde
        } else {
          startListening(); // sadece "Nova" dendi → komutu ayrıca dinle
        }
      };
      w.onend = () => {
        if (wakeRef.current === w) wakeRef.current = null;
        resumeWake();
      };
      w.onerror = () => {
        if (wakeRef.current === w) wakeRef.current = null;
      };
      wakeRef.current = w;
      w.start();
    } catch {
      /* yoksay */
    }
  }

  function startWake() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      alert("Sesli uyandırma güvenli bağlam ister (http://localhost:3000).");
      return;
    }
    if (!getRecognitionCtor()) {
      alert("Tarayıcın sesli uyandırmayı desteklemiyor. Chrome/Edge kullan.");
      return;
    }
    wakeOnRef.current = true;
    onWakeState?.(true);
    // Önceki komut oturumu varsa kapat ki wake garanti başlasın
    try {
      recognitionRef.current?.abort();
    } catch {
      /* yoksay */
    }
    recognitionRef.current = null;
    setTimeout(runWake, 200);
  }

  function stopWake() {
    wakeOnRef.current = false;
    onWakeState?.(false);
    try {
      wakeRef.current?.abort();
    } catch {
      /* yoksay */
    }
    wakeRef.current = null;
  }

  function toggleWake() {
    if (wakeOnRef.current) stopWake();
    else startWake();
  }

  // unmount'ta wake'i kapat
  useEffect(() => {
    return () => {
      wakeOnRef.current = false;
      try {
        wakeRef.current?.abort();
      } catch {
        /* yoksay */
      }
    };
  }, []);

  // Dışarıdan (mikrofon / Boşluk / wake düğmesi) tetikleme
  const micRef = useRef<() => void>(() => {});
  micRef.current = startListening;
  const wakeToggleRef = useRef<() => void>(() => {});
  wakeToggleRef.current = toggleWake;
  useImperativeHandle(
    ref,
    () => ({
      startListening: () => micRef.current(),
      toggleWake: () => wakeToggleRef.current(),
    }),
    [],
  );

  async function send(textArg?: string) {
    const text = (typeof textArg === "string" ? textArg : input).trim();
    const atts = typeof textArg === "string" ? [] : attachments;
    if ((!text && atts.length === 0) || loading) return;

    const base = messagesRef.current;
    const next: Message[] = [
      ...base,
      {
        role: "user",
        content: text,
        attachments: atts.length ? atts : undefined,
      },
    ];
    setMessages(next);
    setInput("");
    setAttachments([]);
    setLoading(true);
    onAgentActivity?.("orchestrator"); // haritada beyin parlasın
    setMessages([...next, { role: "assistant", content: "" }]);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Sunucu hatası (${res.status})`);
      }

      const headerAgent = res.headers.get("X-Nova-Agent");
      const agent: AgentKey = isAgentKey(headerAgent) ? headerAgent : "general";
      onAgentActivity?.(agent); // haritada seçilen ajan parlasın

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setMessages([...next, { role: "assistant", content: "", agent }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc, agent }]);
        scrollToBottom();
      }

      const finalMsgs: Message[] = [
        ...next,
        { role: "assistant", content: acc, agent },
      ];
      persist(finalMsgs);

      if ((speakRef.current || voiceReplyRef.current) && acc) speak(acc);
      voiceReplyRef.current = false;

      fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userText: text, assistantText: acc }),
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      const errMsgs: Message[] = [
        ...next,
        { role: "assistant", content: `⚠️ Hata: ${msg}` },
      ];
      setMessages(errMsgs);
      persist(errMsgs);
    } finally {
      setLoading(false);
      scrollToBottom();
      setTimeout(() => onAgentActivity?.(null), 2500); // bir süre sonra sön
      resumeWake(); // konuşmuyorsa wake'e dön (konuşuyorsa TTS bitince döner)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const glass = {
    background: "rgba(14,20,34,0.6)",
    backdropFilter: "blur(12px)",
  };

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: "var(--border)", ...glass }}
      >
        <div>
          <h1 className="text-lg font-semibold">Sohbet</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {speaking ? (
              <span className="inline-flex items-center gap-2">
                <span className="bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                Nova konuşuyor…
              </span>
            ) : (
              "Orkestratör mesajını doğru uzmana yönlendirir"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {voices.length > 0 && (
            <select
              value={voiceURI}
              onChange={(e) => {
                const uri = e.target.value;
                setVoiceURI(uri);
                try {
                  localStorage.setItem("nova_voice", uri);
                } catch {
                  /* yoksay */
                }
                // seçilen sesle kısa örnek oku
                if (typeof window !== "undefined" && window.speechSynthesis) {
                  const v = window.speechSynthesis
                    .getVoices()
                    .find((x) => x.voiceURI === uri);
                  const u = new SpeechSynthesisUtterance("Merhaba, ben Nova.");
                  if (v) {
                    u.voice = v;
                    u.lang = v.lang;
                  }
                  window.speechSynthesis.cancel();
                  window.speechSynthesis.speak(u);
                }
              }}
              title="Ses seç"
              className="max-w-[130px] truncate rounded-lg border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              {(voices.some((v) => v.lang.toLowerCase().startsWith("tr"))
                ? voices.filter((v) => v.lang.toLowerCase().startsWith("tr"))
                : voices
              ).map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              if (speakEnabled && typeof window !== "undefined")
                window.speechSynthesis?.cancel();
              setSpeakEnabled((v) => !v);
            }}
            title="Yanıtları sesli oku"
            className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: speakEnabled ? "var(--accent)" : "var(--border)",
              color: speakEnabled ? "var(--accent)" : "var(--text-muted)",
              background: speakEnabled ? "#22d3ee14" : "transparent",
            }}
          >
            {speakEnabled ? "🔊 Sesli açık" : "🔇 Sesli kapalı"}
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 && (
            <div className="pop-in flex flex-col items-center gap-4 py-16 text-center">
              <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl">
                <span className="nova-orb absolute inset-0 rounded-2xl opacity-90" />
                <span className="relative text-2xl font-bold text-black">N</span>
              </span>
              <div>
                <div className="text-lg font-semibold">Merhaba, ben Nova 👋</div>
                <p
                  className="mx-auto mt-1 max-w-md text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  Yaz ya da 🎤 ile konuş — görev ver, kod iste, araştır.
                  Orkestratör doğru uzmana yönlendirir.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  "Bugün ne yapsam? kısa bir plan çıkar",
                  "workspace'e fikirler.md oluştur",
                  "React Native mı Flutter mı?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="card rounded-full border px-3 py-1.5 text-xs"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--text-muted)",
                      background: "rgba(20,28,46,0.5)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const isLast = i === messages.length - 1;
            if (isUser) {
              return (
                <div key={i} className="msg-in flex flex-col items-end gap-1">
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
                      {m.attachments.map((a, j) =>
                        a.kind === "image" && a.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={j}
                            src={a.previewUrl}
                            alt={a.name}
                            className="max-h-40 rounded-xl border"
                            style={{ borderColor: "var(--border)" }}
                          />
                        ) : (
                          <span
                            key={j}
                            className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
                            style={{
                              borderColor: "var(--border)",
                              background: "var(--bg-panel)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {a.kind === "pdf" ? "📄" : a.kind === "image" ? "🖼️" : "📎"}{" "}
                            {a.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {m.content && (
                    <div
                      className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--accent-2), var(--accent))",
                        color: "#04121a",
                      }}
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={i} className="msg-in flex flex-col items-start">
                {m.agent && <AgentBadge agent={m.agent} />}
                <div className="flex max-w-[85%] items-start gap-2">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-black"
                    style={{ background: "var(--grad-3)" }}
                  >
                    ✦
                  </span>
                  <div
                    className="whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {m.content || (isLast && loading ? <Typing /> : "")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t px-6 py-4" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto max-w-3xl">
          {/* ek önizlemeleri */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >
                  {a.kind === "image" && a.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      className="h-9 w-9 rounded object-cover"
                    />
                  ) : (
                    <span className="text-base">
                      {a.kind === "pdf" ? "📄" : "📎"}
                    </span>
                  )}
                  <span className="max-w-[120px] truncate">{a.name}</span>
                  <button
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    title="Kaldır"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className="glow-focus flex items-end gap-2 rounded-xl border p-2"
            style={{ borderColor: "var(--border)", ...glass }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.docx,.xlsx,.xls,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.css,.html,.py"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Dosya / resim ekle"
              className="rounded-lg px-3 py-2 text-base"
              style={{ color: "var(--text-muted)" }}
            >
              📎
            </button>
            <button
              onClick={toggleMic}
              disabled={!voiceSupported}
              title={voiceSupported ? "Sesli giriş" : "Tarayıcı desteklemiyor"}
              className={`relative rounded-lg px-3 py-2 text-base disabled:opacity-30 ${
                listening ? "mic-pulse" : ""
              }`}
              style={{
                background: listening ? "#ef444426" : "transparent",
                color: listening ? "#ef4444" : "var(--text-muted)",
              }}
            >
              {listening ? "🔴" : "🎤"}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                listening
                  ? "Dinliyorum… konuş"
                  : "Mesajını yaz… (Enter ile gönder)"
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
              style={{ color: "var(--text)" }}
            />
            <button
              onClick={() => send()}
              disabled={loading || (!input.trim() && attachments.length === 0)}
              className="btn-grad rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent), var(--accent-2))",
              }}
            >
              {loading ? "…" : "Gönder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default Chat;
