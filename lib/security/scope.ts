// KAPSAM KİLİDİ — güvenlik ajanının EN KRİTİK güvencesi.
// Ajan YALNIZCA Yücel'in kendi varlıklarına (allowlist) saldırabilir. Her araç
// çağrısı hedefi buradan geçirir; listede olmayan hiçbir host'a dokunulamaz.
// Bu, testi yetkili/yasal tutar ve "yanlış hedefe ateş" riskini sıfırlar.
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "security", "scope.json");

// Varsayılan allowlist: Yücel'in bilinen kendi varlıkları. UI'dan düzenlenebilir
// ve NOVA_SECURITY_SCOPE env'i ile genişletilebilir. Alt alan adları otomatik dahil.
const DEFAULT_HOSTS = [
  "getdriver.com.tr",
  "cocuk-video.vercel.app",
  "funnybirthday.getdriver.com.tr",
];
// Sahibi olunan IP'ler (VPS). IP'ler yalnız BURADA açıkça listeliyse hedef olabilir.
const DEFAULT_IPS = ["76.13.249.73"];

export type Scope = { hosts: string[]; ips: string[] };

function envHosts(): string[] {
  return (process.env.NOVA_SECURITY_SCOPE || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function getScope(): Promise<Scope> {
  let saved: Partial<Scope> = {};
  try { saved = JSON.parse(await fs.readFile(FILE, "utf8")); } catch { /* ilk çalışma */ }
  const hosts = Array.from(new Set([...DEFAULT_HOSTS, ...envHosts(), ...(saved.hosts ?? [])].map((h) => h.toLowerCase())));
  const ips = Array.from(new Set([...DEFAULT_IPS, ...(saved.ips ?? [])]));
  return { hosts, ips };
}

export async function setScope(s: Scope): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  // yalnız kullanıcı eklentilerini kaydet (varsayılanlar koda gömülü)
  const hosts = s.hosts.map((h) => h.trim().toLowerCase()).filter((h) => h && !DEFAULT_HOSTS.includes(h));
  const ips = s.ips.map((i) => i.trim()).filter((i) => i && !DEFAULT_IPS.includes(i));
  await fs.writeFile(FILE, JSON.stringify({ hosts, ips }), "utf8");
}

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// Bir host (veya URL'den çıkarılan host) kapsam içinde mi?
function hostInScope(host: string, scope: Scope): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (IP_RE.test(h)) return scope.ips.includes(h); // IP yalnız açıkça listeliyse
  // tam eşleşme veya allowlist host'unun alt alan adı
  return scope.hosts.some((a) => h === a || h.endsWith("." + a));
}

export function extractHost(target: string): string {
  const t = target.trim();
  try {
    const u = new URL(t.includes("://") ? t : `http://${t}`);
    return u.hostname;
  } catch {
    return t.split("/")[0].split(":")[0]; // kaba ayrıştırma
  }
}

export type ScopeCheck = { ok: true; host: string } | { ok: false; host: string; reason: string };

// Hedefi (URL ya da host) kapsama göre doğrula. Ajan bunu HER araç çağrısından önce kullanır.
export async function checkTarget(target: string, scope?: Scope): Promise<ScopeCheck> {
  const s = scope ?? (await getScope());
  const host = extractHost(target);
  if (!host) return { ok: false, host, reason: "hedef boş/çözümlenemedi" };
  if (hostInScope(host, s)) return { ok: true, host };
  return { ok: false, host, reason: `"${host}" kapsam dışı — yalnız kendi varlıklarına izin var (${s.hosts.join(", ")})` };
}

export function scopeSummary(s: Scope): string {
  return `İzinli alan adları: ${s.hosts.join(", ")}${s.ips.length ? ` · IP: ${s.ips.join(", ")}` : ""}`;
}
