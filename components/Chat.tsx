"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AGENT_META,
  isAgentKey,
  type AgentActivity,
  type AgentKey,
} from "@/lib/agents/meta";

export type Attachment = {
  kind: "image" | "pdf" | "text";
  name: string;
  mediaType?: string;
  data?: string; // base64 (image/pdf)
  text?: string; // metin dosyaları
  previewUrl?: string; // görsel önizleme (yalnız oturum)
};

export type Kickoff = { text: string; attachments?: Attachment[] } | null;

type Message = {
  role: "user" | "assistant";
  content: string;
  agent?: AgentKey;
  model?: string;
  attachments?: Attachment[];
  // Özel ajan (kullanıcının oluşturduğu) — rozet için
  agentName?: string;
  agentEmoji?: string;
  agentColor?: string;
};

// Model kimliğini kısa okunur ada çevir
function modelLabel(id?: string): string {
  if (!id) return "";
  if (id.includes("opus")) return "Opus 4.8";
  if (id.includes("fable")) return "Fable 5";
  if (id.includes("sonnet")) return "Sonnet 5";
  if (id.includes("haiku")) return "Haiku 4.5";
  return id;
}

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

// Üretilen görsel + indirme butonu (fal URL'lerini proxy ile güvenle indirir).
function GeneratedImage({ url }: { url: string }) {
  return (
    <span className="group relative my-2 inline-block max-w-full">
      <img
        src={url}
        alt="üretilen görsel"
        loading="lazy"
        className="block max-w-full rounded-xl"
        style={{ maxHeight: 460, border: "1px solid var(--border)" }}
      />
      <a
        href={`/api/download?url=${encodeURIComponent(url)}`}
        title="Görseli indir"
        className="btn-grad absolute right-2 top-2 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium"
        style={{
          background: "rgba(4,8,18,0.72)",
          backdropFilter: "blur(6px)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
      >
        ⬇ İndir
      </a>
    </span>
  );
}

// Asistan mesajını render eder: markdown görselleri (![](url)) <img> olarak gösterir.
function MessageBody({ content }: { content: string }) {
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last)
      parts.push(<span key={k++}>{content.slice(last, m.index)}</span>);
    parts.push(<GeneratedImage key={k++} url={m[1]} />);
    last = m.index + m[0].length;
  }
  if (last < content.length)
    parts.push(<span key={k++}>{content.slice(last)}</span>);
  return <>{parts}</>;
}

function AgentBadge({ m }: { m: Message }) {
  let color: string, emoji: string, label: string;
  if (m.agentName) {
    // özel ajan
    color = m.agentColor || "#22d3ee";
    emoji = m.agentEmoji || "🤖";
    label = m.agentName;
  } else if (m.agent && AGENT_META[m.agent]) {
    const meta = AGENT_META[m.agent];
    color = meta.color;
    emoji = meta.emoji;
    label = meta.label;
  } else {
    return null;
  }
  return (
    <span
      className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}
    >
      <span>{emoji}</span>
      {label}
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
  autoSend?: Kickoff;
  onAutoSent?: () => void;
  pinned?: boolean;
};

const Chat = forwardRef<ChatHandle, ChatProps>(function Chat(
  {
    onAgentActivity,
    conversationId,
    onConversationUpdated,
    onVoiceState,
    onWakeState,
    onBusy,
    autoSend,
    onAutoSent,
    pinned,
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
  // Aktif sohbetin canlı kimliği (kapanışta değişmiş olabilir — sızmayı önler)
  const conversationIdRef = useRef<string>("");
  // Şu an arka planda çalışan sohbet kimlikleri (eşzamanlı bağımsız çalışsınlar)
  const runningRef = useRef<Set<string>>(new Set());
  // Sohbet → aktif runId (Durdur bu işi iptal eder)
  const runIdRef = useRef<Map<string, string>>(new Map());
  // Durdurulması istenen sohbet kimlikleri (poll döngüsü görüp çıkar)
  const stopRef = useRef<Set<string>>(new Set());
  const speakRef = useRef(false);
  const voiceReplyRef = useRef(false); // sesle sorulduysa cevabı her zaman seslendir
  const wakeRef = useRef<Recognition | null>(null); // "Nova" wake-word dinleyici
  const wakeOnRef = useRef(false);
  const ttsKeepAlive = useRef<ReturnType<typeof setInterval> | null>(null); // Edge/Chrome 15sn kesme hatası için
  const ttsQueueRef = useRef<string[]>([]); // streaming TTS kuyruğu (cümle cümle)
  const ttsActiveRef = useRef(false);
  // Gerçekçi ses (OpenAI TTS): null=bilinmiyor, true=çalışıyor, false=anahtar yok→tarayıcıya düş
  const neuralTtsRef = useRef<boolean | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // çalan ses (iptal için)
  // Tek yeniden-kullanılabilir <audio> — tarayıcı otomatik-oynatma kilidini aşmak
  // için (her cümlede yeni Audio yaratınca ilk hariç hepsi engellenebiliyor).
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Tarayıcı-içi Whisper (Edge/Safari/Firefox — native STT çalışmaz)
  const [whisperStatus, setWhisperStatus] = useState<
    "idle" | "loading" | "recording" | "transcribing"
  >("idle");
  const [whisperPct, setWhisperPct] = useState(0);
  const recorderRef = useRef<import("@/lib/voice/record").Recorder | null>(null);
  const whisperStatusRef = useRef<"idle" | "loading" | "recording" | "transcribing">("idle");
  whisperStatusRef.current = whisperStatus;

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
    // Canlı aktif-sohbet kimliğini güncelle (arka plan run'ları buna bakar)
    conversationIdRef.current = conversationId ?? "";
    // Yükleme göstergesi: bu sohbet arka planda çalışıyorsa açık, değilse kapalı
    setLoading(runningRef.current.has(conversationId ?? ""));
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
        if (!cancelled) {
          setMessages((d.conversation?.messages ?? []) as Message[]);
          // Sohbete girince en alta (son mesaja) in — DOM hazır olunca anında
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }),
          );
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Yeni proje başlatıldığında: prompt'u otomatik ilk mesaj olarak gönder
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!autoSend) {
      autoSentRef.current = false;
      return;
    }
    if (!conversationId || autoSentRef.current) return;
    autoSentRef.current = true;
    const t = setTimeout(() => {
      send(autoSend.text, autoSend.attachments ?? []);
      onAutoSent?.();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, conversationId]);

  function persist(msgs: Message[], convId?: string) {
    // Hangi sohbete yazacağımızı çağıran belirler (akış sırasında sohbet
    // değişse bile cevap DOĞRU sohbete kaydedilsin — yanlış sohbete sızmasın)
    const cid = convId ?? conversationId;
    if (!cid) return;
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
    fetch(`/api/conversations/${cid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: light }),
    })
      .then(() => onConversationUpdated?.())
      .catch(() => {});
  }

  // Yazışmayı durdur: aktif sohbetin çalışan işini iptal et, girişi hemen aç.
  // Sunucuya iptal gönderir (boşuna token yakılmaz), kısmi cevabı dondurur.
  function stopChat() {
    const cid = conversationId ?? "";
    if (!runningRef.current.has(cid)) return;
    const rid = runIdRef.current.get(cid);
    stopRef.current.add(cid); // poll döngüsü görüp finalize etmeden çıkar
    if (rid)
      fetch(`/api/chat?id=${encodeURIComponent(rid)}`, {
        method: "DELETE",
      }).catch(() => {});
    cancelSpeak(); // konuşuyorsa sesi de kes
    runningRef.current.delete(cid); // hemen yeni mesaj yazılabilsin
    setLoading(false);
    onAgentActivity?.(null);
    // Kısmi cevabı dondur: boş asistan balonunu kaldır, doluysa olduğu gibi kaydet
    setMessages((cur) => {
      const last = cur[cur.length - 1];
      const out =
        last && last.role === "assistant" && !last.content.trim()
          ? cur.slice(0, -1)
          : cur;
      persist(out, cid);
      return out;
    });
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

  // Chrome/Edge, TTS'i ~15 sn sonra duraklatır; resume ile canlı tut
  function startTtsKeepAlive() {
    stopTtsKeepAlive();
    ttsKeepAlive.current = setInterval(() => {
      const s = window.speechSynthesis;
      if (s?.speaking) s.resume();
      else stopTtsKeepAlive();
    }, 8000);
  }
  function stopTtsKeepAlive() {
    if (ttsKeepAlive.current) {
      clearInterval(ttsKeepAlive.current);
      ttsKeepAlive.current = null;
    }
  }

  // Sadece Türkçe düz metni bırak — kodları/teknik kısımları SESLENDİRME.
  function cleanForSpeech(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, " ") // fenced kod blokları
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ") // markdown görsel → at
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // link → sadece metin
      .replace(/`[^`]*`/g, " ") // satır içi kod
      .replace(/https?:\/\/\S+/g, " ") // URL
      .replace(/^[ \t]{4,}\S.*$/gm, " ") // girintili kod satırları
      .replace(/\S*\/\S+\.[A-Za-z0-9]{1,5}\b/g, " ") // dosya yolları
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, "")
      .replace(/[#*_>~|]/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{2,}/g, ". ")
      .replace(/(?:\s*\.){2,}\s*/g, ". ")
      .trim();
  }

  function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    const list = synth.getVoices();
    const tr = list.filter((v) => v.lang.toLowerCase().startsWith("tr"));
    return (
      list.find((v) => v.voiceURI === voiceURIRef.current) ||
      tr.find((v) => v.localService) ||
      tr[0] ||
      list.find((v) => v.localService) ||
      list[0] ||
      null
    );
  }

  // Temiz metni cümlelere bölüp kuyruğa ekle; çalmıyorsa çalmaya başla.
  // Streaming: cevap akarken tamamlanan cümleler kuyruğa eklenip anında okunur.
  function enqueueSpeak(cleanText: string) {
    if (!cleanText) return;
    const parts =
      cleanText.match(/[^.!?…\n]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [
        cleanText,
      ];
    for (const p of parts) {
      if (p.length <= 220) ttsQueueRef.current.push(p);
      else for (let i = 0; i < p.length; i += 200) ttsQueueRef.current.push(p.slice(i, i + 200));
    }
    runQueue();
  }

  // Bir cümleyi OpenAI TTS'ten (gerçekçi ses) çal. Başarılıysa true; anahtar
  // yok / hata varsa false döner (çağıran tarayıcı sesine düşer).
  function playNeural(text: string): Promise<"ok" | "fail" | "nokey"> {
    return new Promise((resolve) => {
      (async () => {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (res.status === 501) return resolve("nokey"); // anahtar yok → tarayıcıya düş
          if (!res.ok) return resolve("fail");
          const blob = await res.blob();
          if (!blob.size) return resolve("fail");
          const url = URL.createObjectURL(blob);
          // TEK ses öğesini yeniden kullan: tarayıcı oynatma kilidi ilk gesture'da
          // açılır ve aynı öğede kalır → sonraki cümleler de çalar. (Her cümlede
          // yeni Audio yaratınca ilkinden sonrası engellenip susuyordu.)
          let audio = audioElRef.current;
          if (!audio) {
            audio = new Audio();
            audioElRef.current = audio;
          }
          const el = audio;
          currentAudioRef.current = el;
          let settled = false;
          const done = (r: "ok" | "fail") => {
            if (settled) return;
            settled = true;
            el.onended = null;
            el.onerror = null;
            el.onpause = null;
            URL.revokeObjectURL(url);
            if (currentAudioRef.current === el) currentAudioRef.current = null;
            resolve(r);
          };
          el.onended = () => done("ok");
          el.onerror = () => done("fail");
          el.src = url;
          el.play()
            .then(() => {
              // Çalmaya başladı; bundan SONRAKİ pause = cancelSpeak (iptal)
              el.onpause = () => done("ok");
            })
            .catch(() => done("fail"));
        } catch {
          resolve("fail");
        }
      })();
    });
  }

  // Tarayıcı Web Speech ile çal (yedek). Promise: bitince çözülür.
  function playBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
      if (!synth) return resolve();
      startTtsKeepAlive();
      const voice = pickVoice(synth);
      const u = new SpeechSynthesisUtterance(text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "tr-TR";
      }
      u.rate = 1;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
  }

  async function runQueue() {
    if (ttsActiveRef.current || ttsQueueRef.current.length === 0) return;
    ttsActiveRef.current = true;
    setSpeaking(true);
    while (ttsActiveRef.current && ttsQueueRef.current.length > 0) {
      const chunk = ttsQueueRef.current.shift();
      if (chunk == null) continue;
      let played = false;
      if (neuralTtsRef.current !== false) {
        const st = await playNeural(chunk);
        if (st === "ok") {
          played = true;
          neuralTtsRef.current = true;
        } else if (st === "nokey") {
          neuralTtsRef.current = false; // sadece anahtar yoksa kalıcı tarayıcıya düş
        }
        // "fail" (geçici) → bu cümlede tarayıcıya düş ama neural'ı kapatma, sonra tekrar dene
      }
      if (!ttsActiveRef.current) break; // arada iptal edildiyse tarayıcıya düşme
      if (!played) await playBrowser(chunk);
    }
    ttsActiveRef.current = false;
    setSpeaking(false);
    stopTtsKeepAlive();
    resumeWake();
  }

  function cancelSpeak() {
    ttsQueueRef.current = [];
    ttsActiveRef.current = false;
    try {
      currentAudioRef.current?.pause();
    } catch {
      /* yoksay */
    }
    currentAudioRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    stopTtsKeepAlive();
  }

  // Tam metni bir kerede seslendir (önceki kuyruğu iptal eder).
  function speak(text: string) {
    cancelSpeak();
    enqueueSpeak(cleanForSpeech(text));
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
    cancelSpeak(); // konuşurken mikrofona basınca Nova sussun (kuyruk dahil)
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

  // --- Tarayıcı-içi Whisper (native STT olmayan/çalışmayan tarayıcılar) ---
  // Chrome native STT'yi iyi yapar; Edge/Safari/Firefox'ta Whisper'a düş.
  function preferWhisper(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const isEdge = /Edg\//.test(ua);
    const isChrome = /Chrome\//.test(ua) && !isEdge && !/OPR\//.test(ua);
    // Chrome (gerçek) + native destek varsa native; aksi halde Whisper
    return !(isChrome && !!getRecognitionCtor());
  }

  async function startWhisper() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      alert("Ses girişi güvenli bağlam (https) ister.");
      return;
    }
    try {
      cancelSpeak();
      // Model yüklü değilse indir (ilk sefer)
      if (whisperStatusRef.current === "idle") {
        const { whisperReady, loadWhisper } = await import("@/lib/voice/whisper");
        if (!whisperReady()) {
          setWhisperStatus("loading");
          setWhisperPct(0);
          onBusy?.(true);
          await loadWhisper((p) => setWhisperPct(p));
        }
      }
      const { startRecording } = await import("@/lib/voice/record");
      recorderRef.current = await startRecording({
        // Konuşman bitip sustuğunda kayıt kendiliğinden dursun → yazıya çevir
        onSpeechEnd: () => {
          if (whisperStatusRef.current === "recording") stopWhisper();
        },
      });
      setWhisperStatus("recording");
      setListening(true);
      onVoiceState?.("listening");
    } catch (err) {
      setWhisperStatus("idle");
      setListening(false);
      onVoiceState?.("idle");
      onBusy?.(false);
      const msg = err instanceof Error ? err.message : "bilinmeyen";
      alert(
        /Permission|NotAllowed|denied/i.test(msg)
          ? "Mikrofon izni reddedildi. Adres çubuğundaki kamera/mikrofon simgesinden izin ver."
          : `Ses başlatılamadı: ${msg}`,
      );
    }
  }

  async function stopWhisper() {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) {
      setWhisperStatus("idle");
      setListening(false);
      onVoiceState?.("idle");
      return;
    }
    setListening(false);
    setWhisperStatus("transcribing");
    onVoiceState?.("idle");
    try {
      const audio = await rec.stop();
      if (!audio || audio.length < 1600) {
        // ~0.1s'den kısa → boş
        setWhisperStatus("idle");
        onBusy?.(false);
        return;
      }
      const { transcribe } = await import("@/lib/voice/whisper");
      const text = (await transcribe(audio)).trim();
      setWhisperStatus("idle");
      onBusy?.(false);
      if (text) {
        voiceReplyRef.current = true;
        send(text);
      }
    } catch {
      setWhisperStatus("idle");
      onBusy?.(false);
    }
  }

  // Mikrofon düğmesi / Boşluk tuşu için birleşik yönlendirme
  function handleMic() {
    if (preferWhisper()) {
      if (whisperStatusRef.current === "recording") stopWhisper();
      else if (whisperStatusRef.current === "idle") startWhisper();
      // loading/transcribing sırasında yok say
    } else {
      startListening();
    }
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

  // unmount'ta wake'i kapat + TTS keepalive'i durdur
  useEffect(() => {
    return () => {
      wakeOnRef.current = false;
      try {
        wakeRef.current?.abort();
      } catch {
        /* yoksay */
      }
      if (ttsKeepAlive.current) clearInterval(ttsKeepAlive.current);
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  // Dışarıdan (mikrofon / Boşluk / wake düğmesi) tetikleme
  const micRef = useRef<() => void>(() => {});
  micRef.current = handleMic;
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

  async function send(textArg?: string, attsArg?: Attachment[]) {
    const text = (typeof textArg === "string" ? textArg : input).trim();
    const atts =
      attsArg ?? (typeof textArg === "string" ? [] : attachments);
    // Bu sohbete kilitli çalış: başka sohbet meşgulken bu sohbette YENİ iş
    // başlatılabilir; ama AYNI sohbette ikinci iş başlatılamaz.
    const myConvId = conversationId ?? "";
    if ((!text && atts.length === 0) || runningRef.current.has(myConvId))
      return;
    // Bu run'ın çıktısı yalnızca kendi sohbeti aktifken ekrana yazsın (sızma yok)
    const active = () => conversationIdRef.current === myConvId;

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
    persist(next, myConvId); // kullanıcı mesajını HEMEN doğru sohbete kaydet
    setInput("");
    setAttachments([]);
    runningRef.current.add(myConvId);
    setLoading(true);
    onAgentActivity?.("orchestrator"); // haritada beyin parlasın
    setMessages([...next, { role: "assistant", content: "" }]);
    scrollToBottom();

    try {
      // 1) İşi başlat — sunucu arka planda çalıştırır, hemen runId döner
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          conversationId: conversationId ?? "",
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Sunucu hatası (${res.status})`);
      }
      const startData = await res.json();
      const runId: string = startData?.runId;
      const isBuiltin = isAgentKey(startData?.agent);
      const agent: AgentKey | undefined = isBuiltin ? startData.agent : undefined;
      const agentName: string | undefined = startData?.agentName;
      const agentEmoji: string | undefined = startData?.agentEmoji;
      const agentColor: string | undefined = startData?.agentColor;
      let model: string | undefined = startData?.model;
      // yerleşik ajanı haritada parlat; özel ajanda orb nötr parlar
      if (active())
        onAgentActivity?.(
          isBuiltin ? (startData.agent as AgentKey) : "orchestrator",
        );
      // Asistan mesajını tüm alanlarıyla kur (rozet özel ajanı da gösterir)
      const mkA = (content: string): Message => ({
        role: "assistant",
        content,
        agent,
        model,
        agentName,
        agentEmoji,
        agentColor,
      });
      if (active()) setMessages([...next, mkA("")]);
      runIdRef.current.set(myConvId, runId); // Durdur bu işi iptal edebilsin

      // 2) Poll ile takip et — bağlantı kopsa bile iş sunucuda sürer, ASLA takılmaz
      let acc = "";
      let offset = 0;
      let status = "running";
      let stopped = false;
      const startedAt = Date.now();

      // Streaming TTS: cevap akarken tamamlanan cümleleri anında oku (bitişi bekleme)
      const willSpeak = speakRef.current || voiceReplyRef.current;
      if (willSpeak) cancelSpeak(); // önceki cevabın sesini durdur
      let spokenChar = 0;
      const pump = (final: boolean) => {
        if (!willSpeak || !active()) return; // arka plandaki sohbet sesli okumasın
        let end = acc.length;
        if (!final) {
          // açık kod bloğu içindeysek kapanana kadar bekle (kodu okumayalım)
          if ((acc.match(/```/g) || []).length % 2 === 1) {
            const li = acc.lastIndexOf("```");
            end = li >= 0 ? li : acc.length;
          }
          // sadece son cümle sınırına kadar olan kısmı seslendir
          const seg = acc.slice(spokenChar, end);
          const m = seg.match(/^[\s\S]*[.!?…\n]/);
          if (!m) return;
          end = spokenChar + m[0].length;
        }
        if (end <= spokenChar) return;
        const cleaned = cleanForSpeech(acc.slice(spokenChar, end));
        spokenChar = end;
        if (cleaned) enqueueSpeak(cleaned);
      };
      while (status === "running") {
        await new Promise((r) => setTimeout(r, 700));
        if (stopRef.current.has(myConvId)) {
          // Kullanıcı Durdur'a bastı: stopChat ekranı/kaydı halletti → çık
          stopped = true;
          break;
        }
        if (Date.now() - startedAt > 20 * 60 * 1000) {
          acc += "\n\n⚠️ Zaman aşımı (20 dk).";
          break;
        }
        let p: {
          status?: string;
          chunk?: string;
          len?: number;
          model?: string;
          error?: string;
        };
        try {
          p = await fetch(
            `/api/chat?id=${encodeURIComponent(runId)}&from=${offset}`,
          ).then((r) => r.json());
        } catch {
          continue; // geçici ağ hatası → tekrar dene, takılma
        }
        if (typeof p.chunk === "string" && p.chunk.length > 0) {
          acc += p.chunk;
          offset = p.len ?? offset;
          if (p.model) model = p.model;
          if (active()) {
            // yalnızca bu sohbet aktifken ekrana yaz (diğer sekmelere sızmasın)
            setMessages([...next, mkA(acc)]);
            scrollToBottom();
          }
          pump(false); // akarken tamamlanan cümleleri sesli oku (pump aktifliği içeride kontrol eder)
        }
        status = p.status ?? "running";
        if (status === "error" && p.error) {
          acc += `\n\n⚠️ ${p.error}`;
          if (active()) setMessages([...next, mkA(acc)]);
        }
      }

      if (stopped) return; // Durdur: sonuçlandırma yapma (finally temizler)

      // Boş yanıtı ASLA kaydetme: boş içerikli mesaj API'yi 400'e düşürüp sohbeti kilitler
      const replyText = acc.trim()
        ? acc
        : "⚠️ Yanıt alınamadı (oturum/bağlantı kesilmiş olabilir). Tekrar dener misin?";
      const finalMsgs: Message[] = [...next, mkA(replyText)];
      if (active()) setMessages(finalMsgs); // arka plandaysa aktif sohbeti ezme
      persist(finalMsgs, myConvId); // sonuç HER ZAMAN kendi sohbetine kaydedilir (liste de yenilenir)

      pump(true); // kalan son cümleyi de oku
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
      if (active()) setMessages(errMsgs);
      persist(errMsgs, myConvId);
    } finally {
      runningRef.current.delete(myConvId); // bu sohbet artık meşgul değil
      runIdRef.current.delete(myConvId);
      stopRef.current.delete(myConvId);
      if (active()) {
        // yalnızca hâlâ bu sohbetteysek arayüzü kapat (başka sohbete geçtiysek dokunma)
        setLoading(false);
        scrollToBottom();
        setTimeout(() => onAgentActivity?.(null), 2500); // bir süre sonra sön
        resumeWake(); // konuşmuyorsa wake'e dön (konuşuyorsa TTS bitince döner)
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && loading) {
      e.preventDefault();
      stopChat(); // çalışıyorsa Esc ile hızlıca durdur
      return;
    }
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
        className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4"
        style={{ borderColor: "var(--border)", ...glass }}
      >
        <div>
          <h1 className="text-lg font-semibold">Sohbet</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {whisperStatus === "loading" ? (
              <span style={{ color: "var(--accent)" }}>
                🎧 Ses modeli indiriliyor… %{whisperPct} (ilk sefer)
              </span>
            ) : whisperStatus === "recording" ? (
              <span style={{ color: "#ef4444" }}>🔴 Dinliyorum — konuş; bitince kendiliğinden durur (ya da tekrar bas)</span>
            ) : whisperStatus === "transcribing" ? (
              <span style={{ color: "var(--accent)" }}>✍️ Çözümleniyor…</span>
            ) : speaking ? (
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
              if (speakEnabled) cancelSpeak();
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
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
                <div className="mb-1 flex items-center gap-1.5">
                  {(m.agent || m.agentName) && <AgentBadge m={m} />}
                  {m.model && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        color: "var(--text-muted)",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid var(--border)",
                      }}
                      title={`Bu yanıt ${modelLabel(m.model)} ile üretildi`}
                    >
                      🧠 {modelLabel(m.model)}
                    </span>
                  )}
                </div>
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
                    {m.content ? (
                      <MessageBody content={m.content} />
                    ) : isLast && loading ? (
                      <Typing />
                    ) : (
                      ""
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t px-4 py-3 sm:px-6 sm:py-4" style={{ borderColor: "var(--border)" }}>
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
            {loading ? (
              <button
                onClick={stopChat}
                title="Yanıtı durdur (Esc)"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{
                  background: "linear-gradient(135deg, #f43f5e, #b91c1c)",
                }}
              >
                ⏹ Durdur
              </button>
            ) : (
              <button
                onClick={() => send()}
                disabled={!input.trim() && attachments.length === 0}
                className="btn-grad rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent), var(--accent-2))",
                }}
              >
                Gönder
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default Chat;
