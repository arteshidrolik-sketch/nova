import { createRelease, loadReleases } from "@/lib/releases/store";

export const runtime = "nodejs";

export async function GET() {
  const releases = (await loadReleases()).sort((a, b) => b.updatedAt - a.updatedAt);
  return Response.json({ releases });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const project = String(body?.project ?? "").trim();
  const version = String(body?.version ?? "").trim();
  const platform = body?.platform;
  if (!project || !version) {
    return Response.json({ error: "project_version_required" }, { status: 400 });
  }
  const plat =
    platform === "ios" || platform === "android" || platform === "web"
      ? platform
      : "ios";
  const release = await createRelease({ project, version, platform: plat });
  return Response.json({ release });
}
