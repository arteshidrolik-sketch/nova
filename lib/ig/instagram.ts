// Instagram (Instagram Login) — yayın + token yenileme.
import crypto from "crypto";
import { loadIg, updateIg } from "./store";

const GRAPH = "https://graph.instagram.com/v23.0";

export async function igToken(): Promise<string> {
  const s = await loadIg();
  const t = s.igToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!t) throw new Error("INSTAGRAM_ACCESS_TOKEN yok");
  return t;
}

function userId(): string {
  const u = process.env.INSTAGRAM_USER_ID;
  if (!u) throw new Error("INSTAGRAM_USER_ID yok");
  return u;
}

async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || j.error) throw new Error(`Instagram: ${j.error?.message || res.status}`);
  return j;
}

// Instagram'ın görseli çekeceği herkese açık imzalı adres.
export function mediaSig(file: string): string {
  const secret = process.env.IG_MEDIA_SECRET || process.env.TELEGRAM_BOT_TOKEN || "nova";
  return crypto.createHmac("sha256", secret).update(file).digest("hex").slice(0, 32);
}

export function publicMediaUrl(file: string): string {
  const base = (process.env.IG_PUBLIC_BASE || "https://nova.getdriver.com.tr").replace(/\/$/, "");
  return `${base}/api/ig/media/${encodeURIComponent(file)}?sig=${mediaSig(file)}`;
}

// Görseli yayınlar → { id, permalink }
export async function publishImage(file: string, caption: string): Promise<{ id: string; permalink?: string }> {
  const token = await igToken();
  const form = (o: Record<string, string>) => new URLSearchParams({ ...o, access_token: token });

  const c = await graph<{ id: string }>(`${GRAPH}/${userId()}/media`, {
    method: "POST",
    body: form({ image_url: publicMediaUrl(file), caption }),
  });

  // Konteyner hazır olana kadar bekle (en fazla ~60 sn)
  for (let i = 0; i < 12; i++) {
    const st = await graph<{ status_code?: string }>(
      `${GRAPH}/${c.id}?fields=status_code&access_token=${token}`,
    );
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED")
      throw new Error(`Instagram konteyner durumu: ${st.status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  const p = await graph<{ id: string }>(`${GRAPH}/${userId()}/media_publish`, {
    method: "POST",
    body: form({ creation_id: c.id }),
  });
  const info = await graph<{ permalink?: string }>(
    `${GRAPH}/${p.id}?fields=permalink&access_token=${token}`,
  ).catch(() => ({ permalink: undefined }));
  return { id: p.id, permalink: info.permalink };
}

// Uzun ömürlü token 60 gün geçerli; haftada bir yenilenir.
export async function refreshTokenIfDue(): Promise<void> {
  const s = await loadIg();
  const WEEK = 7 * 24 * 3600_000;
  if (s.igTokenRefreshedTs && Date.now() - s.igTokenRefreshedTs < WEEK) return;
  const j = await graph<{ access_token: string }>(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${await igToken()}`,
  );
  await updateIg((st) => {
    st.igToken = j.access_token;
    st.igTokenRefreshedTs = Date.now();
  });
}
