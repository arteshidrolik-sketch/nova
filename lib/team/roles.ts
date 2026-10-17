// Proje ekibi: 1 müdür + 3 uzman. İstemci ve sunucuda kullanılabilir (gizli bilgi yok).
export type TeamRole = "manager" | "research" | "coder" | "marketing";

export const TEAM_ROLES: TeamRole[] = ["manager", "research", "coder", "marketing"];
export const SPECIALISTS: Exclude<TeamRole, "manager">[] = ["research", "coder", "marketing"];

export const TEAM_META: Record<TeamRole, { name: string; title: string; color: string; desc: string }> = {
  manager: {
    name: "Müdür", title: "Proje Müdürü", color: "#f5b942",
    desc: "Seninle konuşan tek ajan. İşi parçalar, uygun uzmana verir, sonucu kabul kriterlerine göre denetler; beğenmezse düzelttirir.",
  },
  research: {
    name: "Araştırma", title: "Araştırma Uzmanı", color: "#34d399",
    desc: "Web'de güncel ve kaynaklı araştırma, rakip/pazar analizi, veri toplama ve özetleme.",
  },
  coder: {
    name: "Kod", title: "Yazılım Geliştirici", color: "#4fd8ff",
    desc: "Projenin kodunu okur, yazar, düzeltir, derleyip doğrular; teknik belge ve betik hazırlar.",
  },
  marketing: {
    name: "Satış & Pazarlama", title: "Satış ve Pazarlama Uzmanı", color: "#f472b6",
    desc: "Hedef kitle, konumlandırma, reklam/sosyal medya metni, teklif ve fiyatlandırma; görsel ve VİDEO üretimi/kurgusu (resimlerden tanıtım videosu dahil).",
  },
};

// ---- Model seviyeleri (maliyet): müdür her görev için seçer ----
export type Tier = "hafif" | "standart" | "agir";
export const TIERS: Record<Tier, { model: string; label: string; effort: "low" | "medium" | "high"; note: string }> = {
  hafif: { model: process.env.NOVA_TIER_LIGHT || "claude-haiku-4-5", label: "Haiku", effort: "low", note: "basit, kısa, tek adımlı işler (özet, kısa metin, basit arama)" },
  standart: { model: process.env.NOVA_TIER_STD || "claude-sonnet-5", label: "Sonnet", effort: "medium", note: "çoğu iş (araştırma raporu, kod düzeltme, kampanya metni)" },
  agir: { model: process.env.NOVA_TIER_HEAVY || "claude-opus-5-5", label: "Opus", effort: "high", note: "zor/uzun/kritik işler (mimari, karmaşık hata, derin analiz, revizyonda tekrar takılan iş)" },
};
export function isTier(v: unknown): v is Tier {
  return v === "hafif" || v === "standart" || v === "agir";
}

// ---- Ekip kadrosu: proje başına sabit, kadın-erkek karışık Türkçe isimler ----
export type Gender = "k" | "e";
export type Member = { name: string; gender: Gender; look: number };
const FEMALE = ["Elif", "Zeynep", "Defne", "Ayşe", "Selin", "Ece", "Melis", "Derya", "Nazlı", "Ceren", "Duygu", "İpek", "Aslı", "Gizem", "Buse", "Esra"];
const MALE = ["Emre", "Can", "Mert", "Burak", "Kerem", "Onur", "Tolga", "Barış", "Serkan", "Arda", "Kaan", "Umut", "Eren", "Efe", "Murat", "Ozan"];
function h32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Ekip tamamen kadın (Yücel'in kararı, 2026-10-17). İsimler projeye göre değişir ama sabit kalır.
// Eskiden 2 kadın + 2 erkekti: o zamanki kadın üyeler adlarını korusun diye önce onlara
// eski sırayla isim verilir, sonra eskiden erkek olan rollere yeni kadın adları.
const ALL_FEMALE = true;
export function teamCast(projectId: string): Record<TeamRole, Member> {
  const h = h32(projectId || "nova");
  const patterns: Gender[][] = [
    ["k", "e", "k", "e"], ["e", "k", "e", "k"], ["k", "k", "e", "e"], ["e", "e", "k", "k"], ["k", "e", "e", "k"], ["e", "k", "k", "e"],
  ];
  const g = patterns[h % patterns.length];
  const used = new Set<string>();
  const pick = (pool: string[], seed: number) => {
    for (let i = 0; i < pool.length; i++) { const n = pool[(seed + i * 7) % pool.length]; if (!used.has(n)) { used.add(n); return n; } }
    return pool[0];
  };
  const out = {} as Record<TeamRole, Member>;
  const order = TEAM_ROLES.map((r, i) => ({ r, old: g[i] }));
  if (ALL_FEMALE) order.sort((a, b) => (a.old === b.old ? 0 : a.old === "k" ? -1 : 1));
  for (const { r, old } of order) {
    const gender: Gender = ALL_FEMALE ? "k" : old;
    const seed = h32(projectId + r);
    out[r] = { name: pick(gender === "k" ? FEMALE : MALE, seed), gender, look: seed };
  }
  return out;
}

export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === "string" && (TEAM_ROLES as string[]).includes(v);
}

// Akış satırlarında kullanılan işaretler (sunucu basar; istemci ofis sahnesi okur).
// Biçim: "👥 <Ad> çalışıyor: …", "👥 <Ad> teslim etti", "👔 Müdür denetliyor…"
export const TEAM_LINE = "👥";
export const MANAGER_LINE = "👔";
