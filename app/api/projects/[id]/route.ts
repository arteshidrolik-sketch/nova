import { removeProject, setActive } from "@/lib/projects/store";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = body?.op as string | undefined;

  if (op === "activate") {
    await setActive(id);
    return Response.json({ ok: true });
  }
  if (op === "remove") {
    await removeProject(id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "bad_op" }, { status: 400 });
}
