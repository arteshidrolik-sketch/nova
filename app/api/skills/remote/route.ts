// Açık beceri kataloğu (skills.sh):
// GET  ?q=<arama>                         → {skills:[{name, source, skillId, installs}]}
// GET  ?source=<sahip/depo>               → {skills:[{path, skillId}]} (depodaki tüm SKILL.md)
// POST {source, skillId}                  → önizleme {name, description, content}
// PUT  {source, skillId, roles:[...]}     → Nova ekibine ekle (roller: manager/research/coder/marketing)
import { fetchSkill, listRepoSkills, searchSkills } from "@/lib/skills/remote";
import { createSkill, loadSkills } from "@/lib/skills/store";

export const runtime = "nodejs";
const ROLES = new Set(["manager", "research", "coder", "marketing"]);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("source")) return Response.json({ skills: await listRepoSkills(String(sp.get("source"))) });
    const q = (sp.get("q") ?? "").trim();
    if (q.length < 2) return Response.json({ skills: [] });
    return Response.json({ skills: await searchSkills(q) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "arama hatası" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { source?: string; skillId?: string };
  try { return Response.json(await fetchSkill(String(b.source ?? ""), b.skillId)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "okunamadı" }, { status: 400 }); }
}

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { source?: string; skillId?: string; roles?: string[] };
  const roles = (b.roles ?? []).filter((r) => ROLES.has(r));
  if (!roles.length) return Response.json({ error: "en az bir ajan seç" }, { status: 400 });
  try {
    const s = await fetchSkill(String(b.source ?? ""), b.skillId);
    const tag = `github:${s.source}/${s.path}`;
    if ((await loadSkills()).some((x) => x.source === tag)) return Response.json({ error: "bu beceri zaten ekli" }, { status: 409 });
    const skill = await createSkill({
      name: s.name, description: s.description,
      content: `> Kaynak: https://github.com/${s.source}/blob/HEAD/${s.path} (açık beceri ekosistemi). Nova'da araç adları farklı olabilir; talimatı mevcut araçlarınla uygula, sende olmayan bir aracı ya da komutu varmış gibi kullanma.\n\n${s.content}`,
      agentKeys: [], teamRoles: roles, source: tag,
    });
    return Response.json({ skill });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "eklenemedi" }, { status: 400 });
  }
}
