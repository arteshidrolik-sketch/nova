// Güvenlik ajanının araç kataloğu. Her araç pod'daki gerçek bir güvenlik aracına
// (httpx/subfinder/nmap/ffuf/nuclei/nikto/sqlmap/curl) bağlıdır ve hedefi KAPSAM
// KİLİDİNDEN geçirir. Ajan serbest kabuk komutu çalıştıramaz — yalnız bu araçları,
// yalnız izinli hedeflere. "kesif" araçları zararsız; "saldiri" araçları yıkıcı
// olabilir (sömürü/ele geçirme) — bu yüzden yoğunluk seviyesiyle kapıda tutulur.
import { execOnPodCapture } from "@/lib/studio/tunnel";
import { checkTarget, extractHost, type Scope } from "./scope";

export type SecLevel = "kesif" | "saldiri";
export type SecToolResult = { ok: boolean; output: string; blocked?: boolean };

// Kabuk tek-tırnak kaçışı (argümanlar modelden gelir → enjeksiyon olmasın)
const q = (s: string) => `'${String(s).replace(/'/g, "'\\''")}'`;
const isUrl = (s: string) => /^https?:\/\/[^\s'"]+$/i.test(s);
const isHost = (s: string) => /^[a-zA-Z0-9.-]{1,253}$/.test(s) && !s.includes("..");
// Model arg'ları her biçimde gelebilir (dizi/sayı/eksik anahtar) → savunmacı oku
const str = (v: unknown): string => typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join("\n") : v == null ? "" : String(v);
const pickUrl = (a: A) => str(a.url ?? a.target ?? a.u ?? a.endpoint ?? "").trim();
const pickHost = (a: A) => extractHost(str(a.host ?? a.target ?? a.url ?? a.ip ?? a.domain ?? "").trim());
type A = Record<string, unknown>;

type Spec = {
  level: SecLevel;
  desc: string;
  // argümanlardan pod kabuk komutu üretir; string dönerse arg hatası
  build: (a: A) => { cmd: string; target: string; timeout?: number } | string;
};

// Yaygın yol listesi (ffuf stdin ile) — pod'da sözlük olmasa da çalışır
const COMMON_PATHS = [
  "admin", "login", "api", "api/v1", "dashboard", "config", ".env", ".git/config",
  "backup", "backup.zip", "db", "phpinfo.php", "wp-admin", "wp-login.php", "robots.txt",
  "sitemap.xml", "server-status", "actuator", "actuator/health", "swagger", "swagger-ui",
  "api-docs", "graphql", "console", "debug", "test", "uploads", "files", "static",
  "admin/login", "user", "users", "account", "settings", "metrics", "health", "status",
  ".well-known/security.txt", "id_rsa", ".DS_Store", "web.config", "app.config",
];

const TOOLS: Record<string, Spec> = {
  recon: {
    level: "kesif",
    desc: "Hedef URL'yi incele: HTTP durum, başlıklar, sunucu, teknoloji (curl + whatweb). İlk adım.",
    build: (a) => {
      const url = pickUrl(a);
      if (!isUrl(url)) return "geçersiz url (http(s):// ile başlamalı)";
      return { cmd: `echo "=== BAŞLIKLAR ==="; curl -skS -D - -o /dev/null --max-time 20 ${q(url)}; echo; echo "=== TEKNOLOJİ ==="; whatweb --no-errors --color=never ${q(url)} 2>/dev/null | head -20`, target: url, timeout: 40000 };
    },
  },
  subdomains: {
    level: "kesif",
    desc: "Alan adının alt alan adlarını bul (subfinder). Saldırı yüzeyini genişletir. args: host (ya da url).",
    build: (a) => {
      const host = pickHost(a);
      if (!isHost(host)) return "geçersiz host";
      return { cmd: `subfinder -d ${q(host)} -silent -all 2>/dev/null | head -100`, target: host, timeout: 90000 };
    },
  },
  ports: {
    level: "kesif",
    desc: "Açık portları ve servisleri tara (nmap, ilk 100 port). args: host (ya da url/ip).",
    build: (a) => {
      const host = pickHost(a);
      if (!isHost(host)) return "geçersiz host";
      return { cmd: `nmap -Pn -T4 --top-ports 100 -sV --version-light ${q(host)} 2>/dev/null | grep -E 'open|PORT|VERSION' | head -60`, target: host, timeout: 150000 };
    },
  },
  dirscan: {
    level: "kesif",
    desc: "Gizli dizin/dosyaları ara (ffuf — admin panel, .env, .git, yedek vb.). args: url.",
    build: (a) => {
      const url = pickUrl(a).replace(/\/+$/, "");
      if (!isUrl(url)) return "geçersiz url";
      const list = COMMON_PATHS.map((p) => p.replace(/'/g, "")).join("\\n");
      return { cmd: `printf '${list}\\n' | ffuf -u ${q(url + "/FUZZ")} -w - -mc 200,201,301,302,307,401,403 -t 30 -s 2>/dev/null | head -60`, target: url, timeout: 90000 };
    },
  },
  nuclei: {
    level: "kesif",
    desc: "Bilinen zafiyet/yanlış yapılandırma şablonlarıyla tara (nuclei — CVE, açık panel, sızıntı). args: url.",
    build: (a) => {
      const url = pickUrl(a);
      if (!isUrl(url)) return "geçersiz url";
      return { cmd: `nuclei -u ${q(url)} -severity low,medium,high,critical -silent -nc -timeout 8 2>/dev/null | head -80`, target: url, timeout: 240000 };
    },
  },
  http: {
    level: "kesif",
    desc: "Elle HTTP isteği gönder (curl, SSL doğrulama kapalı) — IDOR, yetki atlama, parametre denemesi, PoC için. args: url, method(GET/POST/PUT/DELETE), headers (['Ad: deger', ...] ya da satır satır metin), data.",
    build: (a) => {
      const url = pickUrl(a);
      if (!isUrl(url)) return "geçersiz url";
      const mRaw = str(a.method).toUpperCase();
      const method = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.test(mRaw) ? mRaw : "GET";
      let cmd = `curl -skS -i --max-time 25 -X ${method}`;
      const hdrs = Array.isArray(a.headers) ? a.headers.map(String) : str(a.headers).split("\n");
      for (const line of hdrs.map((s) => s.trim()).filter(Boolean).slice(0, 12)) {
        if (!line.includes(":") || line.startsWith("-")) continue; // başlık biçiminde değil (curl bayrağı vb.) → atla
        cmd += ` -H ${q(line)}`;
      }
      const data = str(a.data);
      if (data) cmd += ` --data-raw ${q(data.slice(0, 4000))}`;
      cmd += ` ${q(url)} | head -c 8000`;
      return { cmd, target: url, timeout: 35000 };
    },
  },
  nikto: {
    level: "saldiri",
    desc: "Web sunucusu zafiyet taraması (nikto — eski yazılım, tehlikeli dosya, yapılandırma hatası). args: url.",
    build: (a) => {
      const url = pickUrl(a);
      if (!isUrl(url)) return "geçersiz url";
      return { cmd: `nikto -h ${q(url)} -maxtime 120s -nointeractive 2>/dev/null | head -120`, target: url, timeout: 140000 };
    },
  },
  sqli: {
    level: "saldiri",
    desc: "SQL enjeksiyonu tespit + sömür (sqlmap). YIKICI olabilir — veriyi çeker/değiştirebilir. args: url (parametreli), data (POST).",
    build: (a) => {
      const url = pickUrl(a);
      if (!isUrl(url)) return "geçersiz url";
      const d = str(a.data);
      const extra = d ? ` --data=${q(d.slice(0, 2000))}` : "";
      return { cmd: `sqlmap -u ${q(url)}${extra} --batch --level 2 --risk 2 --random-agent --flush-session --disable-coloring 2>&1 | tail -80`, target: url, timeout: 300000 };
    },
  },
  bruteforce: {
    level: "saldiri",
    desc: "Giriş formu/HTTP-auth parola denemesi (hydra). YIKICI — hesap kilitleyebilir. args: host, service(http-post-form/ssh/ftp), user, params.",
    build: (a) => {
      const host = pickHost(a);
      if (!isHost(host)) return "geçersiz host";
      // güvenli ve dar: yalnız kullanıcı verdiği küçük listelerle, kısa
      const user = str(a.user || "admin").replace(/[^a-zA-Z0-9._@-]/g, "").slice(0, 40);
      const svcRaw = str(a.service);
      const svc = /^(ssh|ftp|http-get|http-post-form)$/.test(svcRaw) ? svcRaw : "ssh";
      const params = str(a.params);
      const opt = params ? ` ${q(params.slice(0, 300))}` : "";
      return { cmd: `hydra -l ${q(user)} -P /usr/share/wordlists/rockyou.txt -t 4 -f -w 5 ${q(host)} ${svc}${opt} 2>&1 | head -40`, target: host, timeout: 180000 };
    },
  },
};

export function toolCatalog(maxLevel: SecLevel): { name: string; level: SecLevel; desc: string }[] {
  return Object.entries(TOOLS)
    .filter(([, s]) => maxLevel === "saldiri" || s.level === "kesif")
    .map(([name, s]) => ({ name, level: s.level, desc: s.desc }));
}

// Bir aracı çalıştır: kapsam + yoğunluk kontrolünden geçir, pod'da koştur.
export async function runSecTool(
  name: string, args: A, maxLevel: SecLevel, scope: Scope,
): Promise<SecToolResult> {
  const spec = TOOLS[name];
  if (!spec) return { ok: false, output: `bilinmeyen araç: ${name}` };
  if (spec.level === "saldiri" && maxLevel !== "saldiri") {
    return { ok: false, blocked: true, output: `"${name}" yalnız SALDIRI modunda kullanılabilir (şu an keşif modu).` };
  }
  const built = spec.build(args);
  if (typeof built === "string") return { ok: false, output: `argüman hatası: ${built}` };
  const chk = await checkTarget(built.target, scope);
  if (!chk.ok) return { ok: false, blocked: true, output: `⛔ KAPSAM KİLİDİ: ${chk.reason}` };
  const { out, timedOut } = await execOnPodCapture(built.cmd, built.timeout ?? 120000);
  return { ok: !timedOut, output: out.trim() || "(çıktı yok)" };
}
