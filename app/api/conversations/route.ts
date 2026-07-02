import {
  createConversation,
  ensurePinnedConversation,
  listConversations,
} from "@/lib/conversations/store";
import { ensureNovaProject } from "@/lib/projects/store";

export const runtime = "nodejs";

export async function GET() {
  // "ne var ne yok" her zaman var olsun + Nova'nın kendi kodu ona bağlı (beyin)
  const pinned = await ensurePinnedConversation();
  await ensureNovaProject(pinned.id);
  const conversations = await listConversations();
  return Response.json({ conversations });
}

export async function POST() {
  const conversation = await createConversation();
  return Response.json({ conversation });
}
