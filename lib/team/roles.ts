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
    desc: "Hedef kitle, konumlandırma, reklam/sosyal medya metni, görsel, teklif ve fiyatlandırma.",
  },
};

export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === "string" && (TEAM_ROLES as string[]).includes(v);
}

// Akış satırlarında kullanılan işaretler (sunucu basar; istemci ofis sahnesi okur).
// Biçim: "👥 <Ad> çalışıyor: …", "👥 <Ad> teslim etti", "👔 Müdür denetliyor…"
export const TEAM_LINE = "👥";
export const MANAGER_LINE = "👔";
