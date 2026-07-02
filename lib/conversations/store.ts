// Sohbet (conversation) deposu — yerel dosya. Başlıklı, çok sohbetli.
import { promises as fs } from "fs";
import path from "path";

export type ConvMessage = {
  role: "user" | "assistant";
  content: string;
  agent?: string;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean; // sabit sohbet (silinemez, listede üstte)
  messages: ConvMessage[];
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "conversations.json");
const DEFAULT_TITLE = "Yeni sohbet";
const PINNED_TITLE = "ne var ne yok";

function truncate(s: string, n = 42): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function persist(all: Conversation[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function listConversations(): Promise<
  { id: string; title: string; updatedAt: number; pinned?: boolean }[]
> {
  const all = await loadConversations();
  return all
    .map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      pinned: c.pinned,
    }))
    .sort(
      (a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt,
    );
}

// Sabit "ne var ne yok" sohbetini garantiler (yoksa oluşturur)
export async function ensurePinnedConversation(): Promise<Conversation> {
  const all = await loadConversations();
  const existing = all.find((c) => c.pinned);
  if (existing) return existing;
  const now = Date.now();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: PINNED_TITLE,
    createdAt: now,
    updatedAt: now,
    pinned: true,
    messages: [],
  };
  all.push(conv);
  await persist(all);
  return conv;
}

export async function getConversation(
  id: string,
): Promise<Conversation | undefined> {
  return (await loadConversations()).find((c) => c.id === id);
}

export async function createConversation(): Promise<Conversation> {
  const all = await loadConversations();
  const now = Date.now();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  all.push(conv);
  await persist(all);
  return conv;
}

export async function updateConversation(
  id: string,
  patch: { title?: string; messages?: ConvMessage[] },
): Promise<Conversation | undefined> {
  const all = await loadConversations();
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;

  const conv = all[idx];
  if (patch.messages) conv.messages = patch.messages;

  if (typeof patch.title === "string") {
    conv.title = patch.title.trim() || DEFAULT_TITLE;
  } else if (conv.title === DEFAULT_TITLE) {
    // Kullanıcı kendi başlığını yazmadıysa ilk mesajdan otomatik başlık üret
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser) conv.title = truncate(firstUser.content);
  }

  conv.updatedAt = Date.now();
  all[idx] = conv;
  await persist(all);
  return conv;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const all = await loadConversations();
  const target = all.find((c) => c.id === id);
  if (!target) return false;
  if (target.pinned) return false; // sabit sohbet silinemez
  const next = all.filter((c) => c.id !== id);
  await persist(next);
  return true;
}
