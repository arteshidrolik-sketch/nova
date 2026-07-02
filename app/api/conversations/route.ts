import {
  createConversation,
  ensurePinnedConversation,
  listConversations,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

export async function GET() {
  await ensurePinnedConversation(); // "ne var ne yok" her zaman var olsun
  const conversations = await listConversations();
  return Response.json({ conversations });
}

export async function POST() {
  const conversation = await createConversation();
  return Response.json({ conversation });
}
