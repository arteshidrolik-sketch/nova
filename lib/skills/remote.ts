// Açık beceri ekosistemi (skills.sh / vercel-labs/skills): katalogda ara, GitHub'daki
// SKILL.md'yi oku, Nova ekibinin rollerine beceri olarak ekle. Üçüncü taraf beceriler
// ajanların uyacağı TALİMATLARDIR → kullanıcı önizleyip onaylamadan eklenmez.
export type RemoteSkill = { name: string; source: string; skillId: string; installs: number };

const GH = "https://api.github.com";
const ghHeaders = (): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

export async function searchSkills(q: string): Promise<RemoteSkill[]> {
  const r = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`skills.sh ${r.status}`);
  const j = (await r.json()) as { skills?: { source: string; skillId: string; name: string; installs?: number }[] };
  return (j.skills ?? []).slice(0, 30).map((s) => ({ name: s.name, source: s.source, skillId: s.skillId, installs: s.installs ?? 0 }));
}

// "owner/repo", "https://github.com/owner/repo(/tree/…)", ya da doğrudan SKILL.md bağlantısı
function parseSource(src: string): { owner: string; repo: string } {
  const m = src.trim().match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/);
  if (!m) throw new Error("kaynak 'sahip/depo' ya da GitHub bağlantısı olmalı");
  return { owner: m[1], repo: m[2] };
}

// Depodaki SKILL.md dosyalarının yolları
export async function listRepoSkills(source: string): Promise<{ path: string; skillId: string }[]> {
  const { owner, repo } = parseSource(source);
  const info = (await fetch(`${GH}/repos/${owner}/${repo}`, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) }).then((r) => r.json())) as { default_branch?: string; message?: string };
  if (!info.default_branch) throw new Error(`depo okunamadı: ${info.message ?? "bulunamadı"}`);
  const tree = (await fetch(`${GH}/repos/${owner}/${repo}/git/trees/${info.default_branch}?recursive=1`, { headers: ghHeaders(), signal: AbortSignal.timeout(20000) }).then((r) => r.json())) as { tree?: { path: string; type: string }[] };
  return (tree.tree ?? [])
    .filter((t) => t.type === "blob" && /(^|\/)SKILL\.md$/i.test(t.path))
    .map((t) => ({ path: t.path, skillId: t.path.split("/").slice(-2, -1)[0] || repo }));
}

function frontmatter(md: string): { name?: string; description?: string; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { body: md };
  const get = (k: string) => m[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { name: get("name"), description: get("description"), body: md.slice(m[0].length) };
}

// Bir becerinin SKILL.md içeriği (skillId verilmezse depodaki ilk/tek beceri)
export async function fetchSkill(source: string, skillId?: string): Promise<{ name: string; description: string; content: string; path: string; source: string }> {
  const { owner, repo } = parseSource(source);
  const all = await listRepoSkills(source);
  if (!all.length) throw new Error("depoda SKILL.md bulunamadı");
  const pick = (skillId ? all.find((s) => s.skillId === skillId) ?? all.find((s) => s.path.includes(`/${skillId}/`)) : null) ?? (all.length === 1 ? all[0] : null);
  if (!pick) throw new Error(`"${skillId ?? ""}" bulunamadı; depodaki beceriler: ${all.map((s) => s.skillId).slice(0, 20).join(", ")}`);
  const raw = await fetch(`${GH}/repos/${owner}/${repo}/contents/${pick.path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" }, signal: AbortSignal.timeout(15000),
  });
  if (!raw.ok) throw new Error(`SKILL.md okunamadı (${raw.status})`);
  const md = (await raw.text()).slice(0, 60000);
  const fm = frontmatter(md);
  return { name: fm.name || pick.skillId, description: fm.description || "", content: fm.body.trim(), path: pick.path, source: `${owner}/${repo}` };
}
