// Mağaza durumu (SALT OKUMA): App Store Connect API + Google Play Developer API.
// Ekip mağaza panellerine girmeden inceleme/sürüm/test durumunu görür. Bu modül
// yalnız GET (Play'de: geçici "edit" açıp okur ve siler, hiçbir şeyi kaydetmez).
// Anahtarlar sunucu ortamında: APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY_PATH;
// PLAY_SERVICE_ACCOUNT_PATH. Hangi proje → hangi uygulama: STORE_LINKS (projeId=bundle/paket).
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DIR = path.join(process.cwd(), "data", "stores");
const EVERY_MS = 3 * 3600e3;
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// "ce453fe3-…=com.getdriver.app,…" → { projeId: paket }
function links(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of (process.env.STORE_LINKS ?? "").split(",")) {
    const [k, v] = p.split("=").map((x) => x.trim());
    if (k && v) out[k] = v;
  }
  return out;
}
export function storeLinkFor(projectId: string): string | null { return links()[projectId] ?? null; }

// ---------- Apple ----------
async function appleToken(): Promise<string> {
  const iss = process.env.APPSTORE_ISSUER_ID, kid = process.env.APPSTORE_KEY_ID, file = process.env.APPSTORE_PRIVATE_KEY_PATH;
  if (!iss || !kid || !file) throw new Error("App Store Connect anahtarı tanımlı değil");
  const key = await fs.readFile(file, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}
async function asc(pathQ: string, tok: string): Promise<Record<string, unknown>> {
  const r = await fetch(`https://api.appstoreconnect.apple.com${pathQ}`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(20000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { errors?: { detail?: string }[] };
  if (!r.ok) throw new Error(`App Store Connect ${r.status}: ${j.errors?.[0]?.detail?.slice(0, 140) ?? ""}`);
  return j;
}
type AppleStatus = { app: string; versions: { version: string; state: string; created?: string }[]; builds: { version: string; state: string; uploaded: string }[]; review?: { state: string; submitted?: string } };
async function appleStatus(bundleId: string): Promise<AppleStatus> {
  const tok = await appleToken();
  const apps = (await asc(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`, tok)) as { data?: { id: string; attributes: { name: string } }[] };
  const app = apps.data?.[0];
  if (!app) throw new Error(`App Store'da ${bundleId} bulunamadı`);
  const v = (await asc(`/v1/apps/${app.id}/appStoreVersions?limit=4&fields[appStoreVersions]=versionString,appStoreState,appVersionState,createdDate`, tok)) as {
    data?: { attributes: { versionString: string; appStoreState?: string; appVersionState?: string; createdDate?: string } }[];
  };
  const b = (await asc(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=3&fields[builds]=version,processingState,uploadedDate`, tok)) as {
    data?: { attributes: { version: string; processingState: string; uploadedDate: string } }[];
  };
  let review: AppleStatus["review"];
  try {
    const rs = (await asc(`/v1/reviewSubmissions?filter[app]=${app.id}&limit=1&sort=-submittedDate`, tok)) as { data?: { attributes: { state: string; submittedDate?: string } }[] };
    const r0 = rs.data?.[0];
    if (r0) review = { state: r0.attributes.state, submitted: r0.attributes.submittedDate };
  } catch { /* bu uç yetki istemeyebilir; sürüm durumu yeterli */ }
  return {
    app: app.attributes.name,
    versions: (v.data ?? []).map((x) => ({ version: x.attributes.versionString, state: x.attributes.appVersionState || x.attributes.appStoreState || "?", created: x.attributes.createdDate })),
    builds: (b.data ?? []).map((x) => ({ version: x.attributes.version, state: x.attributes.processingState, uploaded: x.attributes.uploadedDate })),
    review,
  };
}

// ---------- Google Play ----------
async function playToken(): Promise<string> {
  const file = process.env.PLAY_SERVICE_ACCOUNT_PATH;
  if (!file) throw new Error("Play servis hesabı tanımlı değil");
  const sa = JSON.parse(await fs.readFile(file, "utf8")) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), sa.private_key);
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Play yetkisi alınamadı: ${j.error_description ?? r.status}`);
  return j.access_token;
}
type PlayStatus = { tracks: { track: string; releases: { name?: string; status: string; versionCodes: string[] }[] }[] };
async function playStatus(pkg: string): Promise<PlayStatus> {
  const tok = await playToken();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}`;
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  // okumak için geçici edit aç → kanalları oku → edit'i SİL (commit YOK, hiçbir şey değişmez)
  const e = (await fetch(`${base}/edits`, { method: "POST", headers: H, body: "{}", signal: AbortSignal.timeout(15000) }).then((r) => r.json())) as { id?: string; error?: { message?: string } };
  if (!e.id) throw new Error(`Play okunamadı: ${e.error?.message?.slice(0, 140) ?? "?"}`);
  try {
    const t = (await fetch(`${base}/edits/${e.id}/tracks`, { headers: H, signal: AbortSignal.timeout(15000) }).then((r) => r.json())) as {
      tracks?: { track: string; releases?: { name?: string; status: string; versionCodes?: string[] }[] }[];
    };
    return { tracks: (t.tracks ?? []).map((x) => ({ track: x.track, releases: (x.releases ?? []).map((r) => ({ name: r.name, status: r.status, versionCodes: r.versionCodes ?? [] })) })) };
  } finally {
    await fetch(`${base}/edits/${e.id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
}

// ---------- ölçüm + özet ----------
type Snap = { ts: number; apple?: AppleStatus; appleError?: string; play?: PlayStatus; playError?: string };
const snapPath = (id: string) => path.join(DIR, `${safe(id)}.json`);

export async function measureStores(projectId: string): Promise<Snap> {
  const pkg = storeLinkFor(projectId);
  if (!pkg) throw new Error("bu projeye mağaza uygulaması bağlı değil");
  const snap: Snap = { ts: Date.now() };
  if (process.env.APPSTORE_ISSUER_ID) { try { snap.apple = await appleStatus(pkg); } catch (e) { snap.appleError = e instanceof Error ? e.message : String(e); } }
  if (process.env.PLAY_SERVICE_ACCOUNT_PATH) { try { snap.play = await playStatus(pkg); } catch (e) { snap.playError = e instanceof Error ? e.message : String(e); } }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(snapPath(projectId), JSON.stringify(snap));
  return snap;
}

let running = false;
export async function maybeMeasureAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const id of Object.keys(links())) {
      try { const s = JSON.parse(await fs.readFile(snapPath(id), "utf8")) as Snap; if (Date.now() - s.ts < EVERY_MS) continue; } catch { /* ilk ölçüm */ }
      await measureStores(id).catch((e) => console.warn("[mağaza]", id.slice(0, 8), e instanceof Error ? e.message : e));
    }
  } finally { running = false; }
}

const APPLE_TR: Record<string, string> = {
  PREPARE_FOR_SUBMISSION: "gönderime hazırlanıyor", WAITING_FOR_REVIEW: "inceleme sırasında bekliyor", IN_REVIEW: "Apple inceliyor",
  PENDING_DEVELOPER_RELEASE: "onaylandı, senin yayınlamanı bekliyor", READY_FOR_DISTRIBUTION: "YAYINDA", READY_FOR_SALE: "YAYINDA",
  REJECTED: "REDDEDİLDİ", METADATA_REJECTED: "bilgileri reddedildi", DEVELOPER_REJECTED: "geri çekildi", PROCESSING_FOR_DISTRIBUTION: "yayına hazırlanıyor",
  UNRESOLVED_ISSUES: "çözülmemiş sorun var (yanıt bekleniyor)", WAITING_FOR_EXPORT_COMPLIANCE: "ihracat uyumu bekleniyor", ACCEPTED: "kabul edildi",
  READY_FOR_REVIEW: "incelemeye gönderilmeye hazır", COMPLETE: "tamamlandı", CANCELING: "iptal ediliyor",
  VALID: "geçerli", PROCESSING: "işleniyor", FAILED: "başarısız", INVALID: "geçersiz",
};
const PLAY_TR: Record<string, string> = { completed: "yayında", inProgress: "kademeli yayında", draft: "taslak", halted: "durduruldu" };
const TRACK_TR: Record<string, string> = { production: "Üretim", beta: "Açık test", alpha: "Kapalı test", internal: "Dahili test" };

export async function storeSummary(projectId: string): Promise<string> {
  if (!storeLinkFor(projectId)) return "";
  let s: Snap;
  try { s = JSON.parse(await fs.readFile(snapPath(projectId), "utf8")) as Snap; } catch { return ""; }
  const when = new Date(s.ts).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const tr = (x: string, m: Record<string, string>) => (m[x] ? `${m[x]} (${x})` : x);
  const lines = [`Ölçüm: ${when} (Nova 3 saatte bir mağaza API'lerinden salt okuma ile ölçer)`];
  if (s.apple) {
    lines.push(`App Store — ${s.apple.app}:`);
    for (const v of s.apple.versions.slice(0, 3)) lines.push(`  • Sürüm ${v.version}: ${tr(v.state, APPLE_TR)}`);
    if (s.apple.review) lines.push(`  • Son inceleme gönderimi: ${tr(s.apple.review.state, APPLE_TR)}${s.apple.review.submitted ? `, ${new Date(s.apple.review.submitted).toLocaleDateString("tr-TR")}` : ""}`);
    for (const b of s.apple.builds.slice(0, 2)) lines.push(`  • Derleme ${b.version}: ${tr(b.state, APPLE_TR)} (${new Date(b.uploaded).toLocaleDateString("tr-TR")})`);
  } else if (s.appleError) lines.push(`App Store: okunamadı — ${s.appleError}`);
  if (s.play) {
    lines.push("Google Play:");
    for (const t of s.play.tracks) {
      const rel = t.releases.map((r) => `${r.name ?? r.versionCodes.join("/")} → ${tr(r.status, PLAY_TR)}`).join("; ") || "sürüm yok";
      lines.push(`  • ${TRACK_TR[t.track] ?? t.track}: ${rel}`);
    }
    lines.push("  Not: Play'in 'üretim erişimi başvurusu' sonucu API'de görünmez; Üretim kanalında sürüm belirince erişim açılmış demektir. Başvuru sonucu e-postayla gelir.");
  } else if (s.playError) lines.push(`Google Play: okunamadı — ${s.playError}`);
  return lines.join("\n");
}
