// Proje token sayacı: GET /api/team/usage?scope=<proje kimliği>
// Projenin ömrü boyunca toplam ve rol başına token + USD.
import { getProjectUsage } from "@/lib/team/usage";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (!scope) return Response.json({ error: "scope gerekli" }, { status: 400 });
  return Response.json(await getProjectUsage(scope));
}
