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
  kind: "image" | "pdf" | "text" | "video";
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

// Üretilen medyayı blob olarak indirir (yerel dosya ya da fal proxy).
async function saveBlob(fetchUrl: string, filename: string) {
  try {
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  } catch {
    window.open(fetchUrl, "_blank");
  }
}

// Yerel (/api/files) veya uzak (fal) medya için indirme kaynağı + dosya adı.
function mediaDownload(url: string, fallbackName: string) {
  const isLocal = url.startsWith("/api/files");
  const fetchUrl = isLocal
    ? url.replace(/&inline=1\b/, "")
    : `/api/download?url=${encodeURIComponent(url)}`;
  const name = isLocal
    ? decodeURIComponent(url.match(/name=([^&]+)/)?.[1] || fallbackName)
    : fallbackName;
  return { fetchUrl, name };
}

// Üretilen görsel + indirme butonu.
function GeneratedImage({ url }: { url: string }) {
  const { fetchUrl, name } = mediaDownload(url, "nova-gorsel.jpg");
  return (
    <span className="group relative my-2 inline-block max-w-full">
      <img
        src={url}
        alt="üretilen görsel"
        loading="lazy"
        className="block max-w-full rounded-xl"
        style={{ maxHeight: 460, border: "1px solid var(--border)" }}
      />
      <button
        onClick={() => saveBlob(fetchUrl, name)}
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
      </button>
    </span>
  );
}

// Üretilen video + indirme butonu (fal URL'lerini proxy ile güvenle indirir).
function GeneratedVideo({ url }: { url: string }) {
  return (
    <span className="group relative my-2 block max-w-full">
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="block max-w-full rounded-xl"
        style={{ maxHeight: 460, border: "1px solid var(--border)" }}
      />
      <button
        onClick={() => {
          const { fetchUrl, name } = mediaDownload(url, "nova-video.mp4");
          saveBlob(fetchUrl, name);
        }}
        title="Videoyu indir"
        className="btn-grad absolute right-2 top-2 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium"
        style={{
          background: "rgba(4,8,18,0.72)",
          backdropFilter: "blur(6px)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
      >
        ⬇ İndir
      </button>
    </span>
  );
}

// Üretilen belge/dosya için indirme butonu (Dosyalar API'sinden indirir).
function FileDownload({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="btn-grad my-1.5 mr-2 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-black"
      style={{ background: "var(--grad)" }}
      title="Bilgisayarına indir"
    >
      <span className="max-w-[260px] truncate">{label}</span>
      <span className="opacity-80">⬇ İndir</span>
    </a>
  );
}

// Asistan mesajını render eder: markdown görselleri (![](url)) <img>,
// belge indirme linklerini ([ad](/api/files?...)) indirme butonu olarak gösterir.
function MessageBody({ content }: { content: string }) {
  // Sıra önemli: video işareti (!video[..](url)) görsel işaretinden ÖNCE denenir.
  // Görsel/video URL'i hem uzak (http) hem yerel (/api/files) olabilir.
  const re =
    /!video\[[^\]]*\]\(((?:https?:\/\/|\/api\/files)[^\s)]+)\)|!\[[^\]]*\]\(((?:https?:\/\/|\/api\/files)[^\s)]+)\)|\[([^\]]*)\]\((\/api\/files\?[^\s)]+)\)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last)
      parts.push(<span key={k++}>{content.slice(last, m.index)}</span>);
    if (m[1]) parts.push(<GeneratedVideo key={k++} url={m[1]} />);
    else if (m[2]) parts.push(<GeneratedImage key={k++} url={m[2]} />);
    else if (m[4])
      parts.push(
        <FileDownload key={k++} href={m[4]} label={m[3] || "dosya"} />,
      );
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
    color = m.agentColor || "#4fd8ff";
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
  /** Sesli karşılama: metni seslendir, bitince komut dinlemeye geç ve
   *  "Nova" ile uyandırmayı aç (eller serbest). */
  greet: (text: string) => void;
  /** Kısa bir onay/bilgi cümlesi seslendir (ör. "GetDriver sohbetine geçiyorum"). */
  say: (text: string) => void;
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
  /** Sesle verilen ARAYÜZ komutları ("open_ui" ya da "tab:<görünüm>") — sohbete gitmez, üst katman işler */
  onUiCommand?: (cmd: string) => void;
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
    onUiCommand,
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
  const audioCtxRef = useRef<AudioContext | null>(null); // dudak senkronu analizörü
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null); // GC koruması
  const [ttsNote, setTtsNote] = useState<string | null>(null); // ses tanı notu (başlıkta)
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
    const s = listening ? "listening" : speaking ? "speaking" : "idle";
    onVoiceState?.(s);
    // Panodaki Matrix yüzü gibi bağımsız bileşenler için global sinyal
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("nova:voice", { detail: s }));
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

  // Sohbeti temizle: sohbet kalır (başlık/ajan kilidi korunur), mesajlar silinir.
  // Çalışan bir yanıt varsa önce durdurulur; sunucudaki kayıt da boşaltılır.
  function clearChat() {
    if (messages.length === 0 && !loading) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Bu sohbetteki tüm mesajlar silinsin mi? Geri alınamaz.")
    )
      return;
    const cid = conversationId ?? "";
    if (runningRef.current.has(cid)) stopChat();
    cancelSpeak();
    setMessages([]);
    onAgentActivity?.(null);
    if (cid) persist([], cid);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const out: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isVideo =
        file.type.startsWith("video/") ||
        /\.(mp4|mov|webm|m4v)$/i.test(file.name);
      const maxMB = isVideo ? 40 : 8;
      if (file.size > maxMB * 1024 * 1024) {
        alert(`${file.name} çok büyük (en fazla ${maxMB} MB).`);
        continue;
      }
      if (isVideo) {
        const url = await readAsDataURL(file);
        out.push({
          kind: "video",
          name: file.name,
          mediaType: file.type,
          data: url.split(",")[1],
        });
      } else if (file.type.startsWith("image/")) {
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
      } else if (/\.(docx|xlsx|xls|pptx)$/i.test(file.name)) {
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
              // Binary'yi de sakla → edit_excel ve generate_document (kod ortamında
              // gerçek veri analizi) ham dosyayı kullanır
              data: b64,
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
          if (!res.ok) {
            const why = (await res.text().catch(() => "")).slice(0, 120);
            console.warn("[tts] bulut sesi", res.status, why);
            setTtsNote(`Bulut sesi kapalı (${res.status}${why ? ": " + why : ""}) — tarayıcı sesi kullanılıyor.`);
            return resolve("fail");
          }
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
            // Dudak senkronu: ses öğesini Web Audio analizörüne bağla ve analizörü
            // global olayla yayınla (panodaki yüz, ağzı gerçek ses şiddetiyle oynatır).
            try {
              const AC =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
              if (AC) {
                const actx = new AC();
                const src = actx.createMediaElementSource(audio);
                const an = actx.createAnalyser();
                an.fftSize = 1024;
                an.smoothingTimeConstant = 0.4;
                src.connect(an);
                an.connect(actx.destination);
                audioCtxRef.current = actx;
                (window as unknown as { __novaAnalyser?: AnalyserNode }).__novaAnalyser = an;
                window.dispatchEvent(new CustomEvent("nova:audio", { detail: an }));
              }
            } catch {
              /* analizör yoksa yüz kelime-sınırı sinyaliyle idare eder */
            }
          }
          audioCtxRef.current?.resume().catch(() => {});
          const el = audio;
          currentAudioRef.current = el;
          let settled = false;
          const done = (r: "ok" | "fail") => {
            if (settled) return;
            settled = true;
            el.onended = null;
            el.onerror = null;
            el.onpause = null;
            el.onloadedmetadata = null;
            window.dispatchEvent(new CustomEvent("nova:speakend"));
            URL.revokeObjectURL(url);
            if (currentAudioRef.current === el) currentAudioRef.current = null;
            resolve(r);
          };
          el.onended = () => done("ok");
          el.onerror = () => done("fail");
          el.onplaying = () => setTtsNote(null);
          // Dudak senkronu zaman çizelgesi: metin + gerçek süre (metadata gelince)
          el.onloadedmetadata = () => {
            const ms = Number.isFinite(el.duration) ? el.duration * 1000 : text.length * 70;
            window.dispatchEvent(
              new CustomEvent("nova:speak", { detail: { text, durationMs: ms, source: "neural" } }),
            );
          };
          el.src = url;
          el.play()
            .then(() => {
              // Çalmaya başladı; bundan SONRAKİ pause = cancelSpeak (iptal)
              el.onpause = () => done("ok");
            })
            .catch((e) => {
              console.warn("[tts] ses oynatılamadı", e);
              setTtsNote("Ses oynatma engellendi: sayfaya bir kez tıklayıp tekrar dene.");
              done("fail");
            });
        } catch {
          resolve("fail");
        }
      })();
    });
  }

  // Tarayıcı Web Speech ile çal (yedek). Promise: bitince çözülür.
  async function playBrowser(text: string): Promise<void> {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) {
      setTtsNote("Bu tarayıcıda ses sentezi yok.");
      return;
    }
    // Chrome takılması: önceki sentez askıda kaldıysa (speaking/pending) yeni
    // utterance hiç çalmaz → önce iptal et, kısa bekle.
    if (synth.speaking || synth.pending) {
      try {
        synth.cancel();
      } catch {
        /* yoksay */
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    return new Promise((resolve) => {
      startTtsKeepAlive();
      const voice = pickVoice(synth);
      const u = new SpeechSynthesisUtterance(text);
      utterRef.current = u; // Chrome: referans tutulmazsa GC → onend gelmez, ses kesilir
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "tr-TR";
      }
      u.rate = 1;
      u.pitch = 1;
      let settled = false;
      let started = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        clearTimeout(startGuard);
        window.dispatchEvent(new CustomEvent("nova:speakend"));
        resolve();
      };
      // Süre sigortası: onend hiç gelmezse kuyruk sonsuza dek beklemesin
      const guard = setTimeout(finish, text.length * 90 + 5000);
      // Başlangıç sigortası: 1.5 sn'de başlamadıysa duraklamış olabilir → resume
      const startGuard = setTimeout(() => {
        if (!started) {
          try {
            synth.resume();
          } catch {
            /* yoksay */
          }
        }
      }, 1500);
      // Tarayıcı sesinde dalga verisi yok → her kelime sınırında yüzün ağzına
      // "hece" darbesi gönder (panodaki yüz kelimeleri takip etsin).
      u.onboundary = (ev) => {
        window.dispatchEvent(
          new CustomEvent("nova:mouth", { detail: { len: ev.charLength || 4 } }),
        );
      };
      // Metin tabanlı zaman çizelgesi (Chrome'un çevrimiçi sesleri boundary
      // olayı göndermez): ~14 karakter/sn Türkçe konuşma hızı varsayımı
      u.onstart = () => {
        started = true;
        setTtsNote(null); // ses çalıyor → eski uyarıyı kaldır
        window.dispatchEvent(
          new CustomEvent("nova:speak", {
            detail: { text, durationMs: Math.max(400, text.length * 72), source: "browser" },
          }),
        );
      };
      u.onend = finish;
      u.onerror = (ev) => {
        const code = (ev as { error?: string }).error || "bilinmeyen";
        if (code !== "interrupted" && code !== "canceled") {
          console.warn("[tts] tarayıcı sesi hatası:", code);
          setTtsNote(
            code === "not-allowed"
              ? "Tarayıcı sesi engellendi: sayfaya bir kez tıklayıp tekrar dene."
              : `Tarayıcı sesi hatası: ${code}`,
          );
        }
        finish();
      };
      try {
        synth.speak(u);
      } catch (e) {
        console.warn("[tts] speak() hatası", e);
        setTtsNote("Tarayıcı sesi başlatılamadı.");
        finish();
      }
    });
  }

  async function runQueue() {
    if (ttsActiveRef.current || ttsQueueRef.current.length === 0) return;
    ttsActiveRef.current = true;
    setSpeaking(true);
    pauseWake(); // konuşurken wake dinlemesin (kendi "Nova" sözüne tetiklenmesin)
    // Araya girme: konuşma boyunca kullanıcıyı dinle (yankı filtresiyle)
    spokenWordsRef.current = new Set();
    spokenListRef.current = [];
    spokenTrigramsRef.current = new Set();
    bargeFiredRef.current = false;
    stopBarge();
    startBarge();
    while (ttsActiveRef.current && ttsQueueRef.current.length > 0) {
      const chunk = ttsQueueRef.current.shift();
      if (chunk == null) continue;
      rememberSpoken(chunk);
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
    lastTtsEndRef.current = Date.now(); // konuşma sonrası yankı penceresi başlangıcı
    setSpeaking(false);
    stopTtsKeepAlive();
    const wasGreeting = listenAfterSpeakRef.current;
    listenAfterSpeakRef.current = false;
    if (wasGreeting) {
      // Karşılama bitti → eller serbest: wake'i aç
      wakeOnRef.current = true;
      onWakeState?.(true);
    }
    if (bargeFiredRef.current) {
      // Kullanıcı araya girdi: barge dinleyicisi cümlenin sonunu alıp teslim edecek
      return;
    }
    stopBarge();
    // Karşılıklı konuşma: eller-serbest moddaysa Nova sustuktan sonra "Nova"
    // demeden DOĞRUDAN dinle; sessizlikte kendiliğinden wake'e döner.
    // (Whisper yolunda kayıt elle durduğu için otomatik başlatma yapılmaz.)
    // Hoparlörün kuyruğu (yankı) mikrofona girmesin diye kısa bir nefes payı
    if (wasGreeting || (wakeOnRef.current && !preferWhisper()))
      setTimeout(() => { if (!ttsActiveRef.current) micRef.current(); }, 550);
    else resumeWake();
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

  // Karşılama: konuşma bitince komut dinlemeye geç (runQueue sonunda okunur)
  const listenAfterSpeakRef = useRef(false);

  // Türkçe metni karşılaştırma için sadeleştir: küçük harf, ASCII, sadece harf/rakam
  function normTr(s: string): string {
    return s
      .toLowerCase()
      .replace(/i̇/g, "i")
      .replace(/ü/g, "u").replace(/ç/g, "c").replace(/ı/g, "i")
      .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ğ/g, "g")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Sesle gelen metin: önce ARAYÜZ komutu mu bak ("arayüzü aç" → üst katman),
  // değilse normal sohbete gönder (cevap sesli döner). STT "ara yüzü aç" gibi
  // boşluklu/ekli yazabildiği için boşluksuz-ASCII eşleşme kullanılır.
  // Sesle sekme gezinmesi: "<sekme> aç/git/geç/göster" ya da "<sekme> sekmesi"
  const VOICE_TABS: [RegExp, string, string][] = [
    [/calisma alan|ana ekran|ana sayfa|anasayfa/, "harita", "Çalışma Alanı"],
    [/brifing/, "brifing", "Brifing"],
    [/gorev/, "tasks", "Görevler"],
    [/proje/, "projeler", "Projeler"],
    [/dosya/, "dosyalar", "Dosyalar"],
    [/fatura/, "fatura", "Fatura"],
    [/beceri/, "beceriler", "Beceriler"],
    [/surum/, "surumler", "Sürümler"],
    [/loop|dongu/, "loops", "Loops"],
    [/ajan/, "ajanlar", "Ajanlar"],
    [/kontrol|guardrail/, "guardrail", "Kontrol"],
    [/denetim/, "denetim", "Denetim"],
    [/ayar/, "ayarlar", "Ayarlar"],
  ];

  function voiceSend(raw: string) {
    const t = raw.trim();
    if (!t) return;
    const n = normTr(t);
    const ns = n.replace(/\s/g, "");
    const wantsNav = /(^|\s)(ac|git|gec|goster|gel|getir)\w*(\s|$)|sekme|ekran|bolum/.test(n);
    // Kısa ifadeler ("fatura", "dosyalar", "getdriver sohbeti") iş fiili
    // taşımıyorsa gezinme sayılır — STT fiili bozuk yazsa bile çalışsın.
    const words = n.split(" ").filter(Boolean);
    const workVerb =
      /(^|\s)(oku|yap|uret|hazirla|yaz|ciz|olustur|ekle|sil|duzelt|degistir|analiz|ozet|cevir|bul|ara|anlat|acikla|hesapla|gonder|kaydet|indir)\w*(\s|$)/.test(n);
    const navLike = wantsNav || (words.length <= 3 && !workVerb);
    // 0) Sohbet gezinmesi: "yeni sohbet aç" / "<ad> sohbetine geç" → üst katman
    //    sohbet listesinde adı eşleştirir. ("... sohbeti hakkında bilgi ver" gibi
    //    iş cümleleri sohbete gider.)
    if (/yeni sohbet/.test(n)) {
      onUiCommand?.("conv:new");
      return;
    }
    if (navLike && /sohbet/.test(n)) {
      const name = n
        .split("sohbet")[0]
        .replace(/(^|\s)(bana|su|bu|o|lutfen|nova)(\s|$)/g, " ")
        .trim();
      if (name) {
        onUiCommand?.(`conv:${name}`);
        return;
      }
    }
    // 1) Sekme gezinmesi (gezinme fiili + sekme adı, ya da kısa ifade) —
    //    "fatura oku" gibi iş istekleri (iş fiili) sohbete gider.
    if (navLike) {
      for (const [re, key, label] of VOICE_TABS) {
        if (re.test(n)) {
          onUiCommand?.(`tab:${key}`);
          speak(`${label} sekmesini açıyorum.`);
          return;
        }
      }
    }
    // 2) Arayüzü aç → ana sayfa (karşılama ekranından çık). STT "ara yüz",
    //    "arayüzü aş" gibi yazabildiği için "aray" geçmesi yeterli.
    if (/aray/.test(ns) || /ekran\w{0,3}(ac|goster)/.test(ns)) {
      onUiCommand?.("open_ui");
      speak("Arayüzü açıyorum.");
      return;
    }
    voiceReplyRef.current = true;
    send(t);
  }

  // --- Araya girme (barge-in): Nova konuşurken kullanıcı konuşursa Nova susar ---
  // Ayrı bir tanıyıcı TTS boyunca dinler. Yankı filtresi: duyulan sözlerin
  // yarısından fazlası Nova'nın bu turda söylediklerindeyse kendi sesidir, yok say.
  const bargeRef = useRef<Recognition | null>(null);
  const bargeFiredRef = useRef(false);
  const bargeFromRef = useRef(0);
  const spokenWordsRef = useRef<Set<string>>(new Set());
  // Yankı filtresi için bu turda söylenenlerin listesi + harf üçlüleri; TTS bitiş anı
  const spokenListRef = useRef<string[]>([]);
  const spokenTrigramsRef = useRef<Set<string>>(new Set());
  const lastTtsEndRef = useRef(0);

  // Duyulan parça Nova'nın KENDİ sesi mi (hoparlör → mikrofon yankısı)?
  // STT yankıyı bozuk yazar ("skorla"→"sporla", "Anthropic'in"→"Atropi'nin"), bu
  // yüzden birebir kelime eşleşmesi yetmez: bulanık kelime benzerliği (önek /
  // Levenshtein) + harf üçlüsü örtüşmesi birlikte kullanılır.
  function lev(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  function wordSim(a: string, b: string): boolean {
    if (a === b) return true;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.length >= 2 && a.slice(0, 2) === b.slice(0, 2); // 2025~2000 (STT sayı bozması)
    if (a.length < 4 || b.length < 4) return false; // kısa kelimeler yalnız birebir
    if (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true; // ortak önek (ek farkı)
    if (Math.abs(a.length - b.length) > 2) return false;
    return lev(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);
  }
  const STOP = new Set(["bu","bir","ve","ile","de","da","mi","mu","ne","o","su","icin","ama","peki","tamam","evet","hayir","ki","cok","daha","gibi","ya","hem","ise","sen","ben"]);
  // strict=true: konuşma SONRASI pencere — kullanıcı Nova'nın önerisini tekrar
  // edebilir ("Türkiye'deki gelişmeleri anlat"), o yüzden yalnız çok güçlü
  // benzerlik yankı sayılır. strict=false: Nova konuşurken (araya girme).
  function isEcho(seg: string, strict = false): boolean {
    const heard = normTr(seg).split(" ").filter((w) => w.length >= 2);
    if (heard.length === 0) return true;
    const list = spokenListRef.current;
    if (list.length === 0) return false;
    const sim = (w: string) => spokenWordsRef.current.has(w) || list.some((s) => wordSim(w, s));
    // 1) içerik kelimesi oranı (dolgu sözcükler sayılmaz)
    const content = heard.filter((w) => !STOP.has(w));
    const hit = content.filter(sim).length;
    const ratio = content.length >= 2 ? hit / content.length : 0;
    // 2) sıralı örtüşme: yankı, söylenenin kelime SIRASINI korur
    let run = 0;
    for (let i = 0; i < heard.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (!wordSim(heard[i], list[j])) continue;
        let k = 1;
        while (i + k < heard.length && j + k < list.length && wordSim(heard[i + k], list[j + k])) k++;
        if (k > run) run = k;
      }
    }
    // 3) harf üçlüsü örtüşmesi (bozuk STT'ye dayanıklı)
    let tri = 0;
    const h = heard.join(" ");
    if (h.length >= 10) {
      const tg = spokenTrigramsRef.current;
      let c = 0, n = 0;
      for (let i = 0; i + 3 <= h.length; i++) { n++; if (tg.has(h.slice(i, i + 3))) c++; }
      tri = n ? c / n : 0;
    }
    // üçlü ölçütü yalnız uzun parçalarda anlamlı (kısa cümlelerde ortak kelimeler şişirir)
    const longEnough = h.length >= 28;
    if (strict) return run >= 4 || ratio >= 0.75 || (longEnough && tri >= 0.85);
    return run >= 3 || ratio >= 0.5 || (longEnough && tri >= 0.75);
  }
  function rememberSpoken(chunk: string) {
    const nt = normTr(chunk);
    for (const w of nt.split(" ")) {
      if (!w) continue;
      spokenWordsRef.current.add(w);
      spokenListRef.current.push(w);
    }
    for (let i = 0; i + 3 <= nt.length; i++) spokenTrigramsRef.current.add(nt.slice(i, i + 3));
  }

  function stopBarge() {
    try {
      bargeRef.current?.abort();
    } catch {
      /* yoksay */
    }
    bargeRef.current = null;
  }
  function startBarge() {
    if (bargeRef.current) return;
    if (typeof window !== "undefined" && !window.isSecureContext) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const b = new Ctor();
      b.lang = "tr-TR";
      b.interimResults = true;
      b.continuous = true;
      b.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        const seg = last[0].transcript;
        if (!bargeFiredRef.current) {
          const words = normTr(seg).split(" ").filter(Boolean);
          if (words.length < 3) return; // tek-iki bozuk kelimeyle araya girme
          if (isEcho(seg)) return; // Nova'nın kendi sesi (yankı) → yok say
          bargeFiredRef.current = true;
          bargeFromRef.current = e.results.length - 1;
          cancelSpeak(); // kullanıcı konuşuyor → Nova sussun
        }
        if (last.isFinal) {
          let t = "";
          for (let i = bargeFromRef.current; i < e.results.length; i++)
            t += e.results[i][0].transcript + " ";
          stopBarge();
          bargeFiredRef.current = false;
          const txt = t.trim();
          // İkinci savunma: tamamlanan metin yine Nova'nın sözüyse GÖNDERME
          // (kendi cümlesini soru sanıp kısır döngüye girmesin)
          if (!txt || isEcho(txt)) {
            resumeWake();
            return;
          }
          voiceSend(txt);
        }
      };
      b.onend = () => {
        if (bargeRef.current !== b) return;
        bargeRef.current = null;
        if (ttsActiveRef.current && !bargeFiredRef.current) startBarge(); // sessizlikte kapandıysa sürdür
        else {
          bargeFiredRef.current = false;
          resumeWake();
        }
      };
      b.onerror = () => {
        if (bargeRef.current === b) bargeRef.current = null;
      };
      bargeRef.current = b;
      b.start();
    } catch {
      bargeRef.current = null;
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
    stopBarge(); // araya-girme dinleyicisi de mikrofonu bıraksın
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
          // Konuşma bittikten hemen sonra duyulan şey Nova'nın kendi kuyruğu
          // (hoparlör yankısı) olabilir → kendi sözüne benziyorsa gönderme
          if (Date.now() - lastTtsEndRef.current < 4000 && isEcho(t, true)) return;
          voiceSend(t);
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
        if (code === "network") {
          // Yerel tanıma bu oturumda servise ulaşamıyor → sessizce tarayıcı-içi
          // Whisper'a düş (wake de yerel tanıma istediğinden kapanır).
          nativeFailedRef.current = true;
          wakeOnRef.current = false;
          onWakeState?.(false);
          startWhisper();
          return;
        }
        const msg =
          code === "not-allowed" || code === "service-not-allowed"
            ? "Mikrofon izni reddedildi. Adres çubuğundaki 🔒 / kamera simgesinden mikrofona izin ver."
            : code === "audio-capture"
              ? "Mikrofon bulunamadı. Cihaz bağlı mı?"
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

  // --- Tarayıcı-içi Whisper (yalnız native STT olmayan/çalışmayan tarayıcılar) ---
  // Yerel (tarayıcı) tanıma varsa ONU kullan: Chromium tabanlı tarayıcılarda
  // (Chrome, Edge, Opera) bulut destekli ve Türkçe kısa komutlarda tarayıcı-içi
  // Whisper'dan çok daha isabetli. Whisper'a yalnız native yoksa (Safari/Firefox)
  // ya da native bu oturumda ağ/servis hatası verdiyse düşülür.
  const nativeFailedRef = useRef(false);
  function preferWhisper(): boolean {
    if (typeof navigator === "undefined") return false;
    if (nativeFailedRef.current) return true;
    return !getRecognitionCtor();
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
      if (text) voiceSend(text);
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
    if (bargeRef.current) return; // araya-girme dinleyicisi mikrofonu tutuyor
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) return;
    if (ttsActiveRef.current) return; // Nova konuşurken (neural TTS dahil) kendi sesine uyanmasın
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
          voiceSend(cmd); // "Nova <komut>" — tek seferde
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
  const greetRef = useRef<(t: string) => void>(() => {});
  greetRef.current = (text: string) => {
    listenAfterSpeakRef.current = true;
    speak(text);
  };
  const sayRef = useRef<(t: string) => void>(() => {});
  sayRef.current = (text: string) => speak(text);
  useImperativeHandle(
    ref,
    () => ({
      startListening: () => micRef.current(),
      toggleWake: () => wakeToggleRef.current(),
      greet: (text: string) => greetRef.current(text),
      say: (text: string) => sayRef.current(text),
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
      // 1) İşi başlat — sunucu arka planda çalıştırır, hemen runId döner.
      // Anlık bağlantı kopması ("Failed to fetch") kullanıcıya hata olarak
      // yansımasın diye başlatma isteği 3 kez, artan beklemeyle denenir.
      // Sunucu asıl hata dönerse (4xx/5xx) tekrar denemeden hemen bildirilir.
      let res: Response | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stopRef.current.has(myConvId)) return; // arada Durdur'a basıldıysa
        try {
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: next,
              conversationId: conversationId ?? "",
            }),
          });
          break; // HTTP cevabı geldi (ok olmasa da) → tekrar deneme
        } catch (e) {
          lastErr = e; // yalnızca ağ hatası (fetch reddi) buraya düşer
          if (attempt < 2)
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (!res) {
        throw new Error(
          "Bağlantı kurulamadı (internet/tünel kısa süreli kesilmiş olabilir). Lütfen tekrar dene." +
            (lastErr instanceof Error ? ` [${lastErr.message}]` : ""),
        );
      }
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
          // Sunucudaki işi de iptal et → arka planda token yakmaya devam etmesin
          fetch(`/api/chat?id=${encodeURIComponent(runId)}`, {
            method: "DELETE",
          }).catch(() => {});
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
              background: speakEnabled ? "#4fd8ff14" : "transparent",
            }}
          >
            {speakEnabled ? "🔊 Sesli açık" : "🔇 Sesli kapalı"}
          </button>
          {ttsNote && (
            <span
              className="max-w-[260px] truncate text-[11px]"
              title={ttsNote}
              style={{ color: "#fbbf24" }}
            >
              ⚠ {ttsNote}
            </span>
          )}
          <button
            onClick={clearChat}
            disabled={messages.length === 0 && !loading}
            title="Sohbeti temizle (mesajları sil, sohbet kalır)"
            className="rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-muted)",
              background: "transparent",
            }}
          >
            🧹 Temizle
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
              accept="image/*,video/*,application/pdf,.mp4,.mov,.webm,.m4v,.docx,.xlsx,.xls,.pptx,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.css,.html,.py"
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
