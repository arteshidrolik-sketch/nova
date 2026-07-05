import {
  createConversation,
  ensurePinnedConversation,
  listConversations,
} from "@/lib/conversations/store";
import { ensureNovaProject } from "@/lib/projects/store";

export const runtime = "nodejs";

export async function GET() {
  // Beyin (kendini geliştirme) şimdilik kapalı; NOVA_BRAIN=1 ile geri açılır.
  if (process.env.NOVA_BRAIN === "1") {
    const pinned = await ensurePinnedConversation();
    await ensureNovaProject(pinned.id);
  }
  const conversations = await listConversations();
  return Response.json({ conversations });
}

export async function POST() {
  const conversation = await createConversation();
  return Response.json({ conversation });
}
