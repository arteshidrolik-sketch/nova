// Hem sunucu hem istemcide kullanılabilir (gizli bilgi yok, sadece etiketler).

export type AgentKey =
  | "general"
  | "developer"
  | "codeReviewer"
  | "research"
  | "releaseStore"
  | "projectOps";

export const AGENT_META: Record<
  AgentKey,
  { label: string; emoji: string; color: string }
> = {
  general: { label: "Genel", emoji: "✨", color: "#8b5cf6" },
  developer: { label: "Geliştirici", emoji: "💻", color: "#22d3ee" },
  codeReviewer: { label: "Code Reviewer", emoji: "🔍", color: "#f59e0b" },
  research: { label: "Araştırma", emoji: "🔎", color: "#10b981" },
  releaseStore: { label: "Release & Store", emoji: "🚀", color: "#ef4444" },
  projectOps: { label: "Proje/Operasyon", emoji: "📁", color: "#3b82f6" },
};

export const AGENT_KEYS = Object.keys(AGENT_META) as AgentKey[];

// Haritada hangi düğümün canlı olduğunu paylaşmak için
export type AgentActivity = AgentKey | "orchestrator" | null;

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && value in AGENT_META;
}
