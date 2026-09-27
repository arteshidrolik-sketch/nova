// Ajana göre model seçimi: hafif işler ucuz/hızlı modelde, kodlama en güçlü modelde.
import type { AgentKey } from "./meta";

// Kullanıcı tercihi (27.09.2026): tüm ajanlar en güncel Opus'ta (Claude Opus 5).
// Daha ucuz/hızlı bir ajan istenirse NOVA_MODEL_<AJAN>=claude-sonnet-5 ile ezilebilir.
const OPUS = "claude-opus-5"; // en güçlü güncel Opus

export const AGENT_MODELS: Record<AgentKey, string> = {
  general: OPUS,
  developer: OPUS,
  codeReviewer: OPUS,
  research: OPUS,
  releaseStore: OPUS,
  projectOps: OPUS,
};

// İstersen ortam değişkeniyle ezebilirsin: NOVA_MODEL_DEVELOPER=... gibi.
export function modelForAgent(agent: AgentKey): string {
  const envOverride = process.env[`NOVA_MODEL_${agent.toUpperCase()}`];
  return envOverride || AGENT_MODELS[agent] || process.env.NOVA_MODEL || OPUS;
}
