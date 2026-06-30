import { createConversation, listConversations } from "@/lib/conversations/store";

export const runtime = "nodejs";

export async function GET() {
  const conversations = await listConversations();
  return Response.json({ conversations });
}

export async function POST() {
  const conversation = await createConversation();
  return Response.json({ conversation });
}
