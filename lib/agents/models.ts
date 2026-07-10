// Ajana göre model seçimi: hafif işler ucuz/hızlı modelde, kodlama en güçlü modelde.
import type { AgentKey } from "./meta";

const OPUS = "claude-opus-4-8"; // en güçlü — kodlama/inceleme
const FABLE = "claude-fable-5"; // hızlı/ucuz — genel sohbet
const SONNET = "claude-sonnet-5"; // dengeli — araştırma/planlama/store

export const AGENT_MODELS: Record<AgentKey, string> = {
  general: SONNET, // genel sohbet de güçlü model + düşünme (kullanıcı tercihi)
  developer: OPUS,
  codeReviewer: OPUS,
  research: SONNET,
  releaseStore: SONNET,
  projectOps: SONNET,
};

// İstersen ortam değişkeniyle ezebilirsin: NOVA_MODEL_DEVELOPER=... gibi.
export function modelForAgent(agent: AgentKey): string {
  const envOverride = process.env[`NOVA_MODEL_${agent.toUpperCase()}`];
  return envOverride || AGENT_MODELS[agent] || process.env.NOVA_MODEL || OPUS;
}
