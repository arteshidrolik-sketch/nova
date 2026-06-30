// GitHub salt-okuma aracı: bir deponun son commit / PR / issue'larını getirir.
// GITHUB_TOKEN varsa kullanılır (özel repo + yüksek limit); yoksa public repolar
// sınırlı oranla çalışır.

export const GITHUB_TOOL = {
  name: "github_lookup",
  description:
    "Bir GitHub deposundaki son commit, açık pull request veya açık issue'ları getirir. SADECE kullanıcı belirli bir GitHub deposu hakkında güncel bilgi istediğinde kullan.",
  input_schema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "Depo sahibi, örn. vercel" },
      repo: { type: "string", description: "Depo adı, örn. next.js" },
      kind: {
        type: "string",
        enum: ["commits", "pulls", "issues"],
        description: "Ne getirilecek",
      },
      limit: {
        type: "integer",
        description: "Kaç kayıt (varsayılan 5, en fazla 20)",
      },
    },
    required: ["owner", "repo", "kind"],
  },
};

type GithubInput = {
  owner?: string;
  repo?: string;
  kind?: string;
  limit?: number;
};

export async function runGithubLookup(input: GithubInput): Promise<string> {
  const owner = input.owner?.trim();
  const repo = input.repo?.trim();
  const kind = input.kind === "pulls" || input.kind === "issues" ? input.kind : "commits";
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);

  if (!owner || !repo) return "Hata: 'owner' ve 'repo' gerekli.";

  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const url =
    kind === "commits"
      ? `${base}/commits?per_page=${limit}`
      : kind === "pulls"
        ? `${base}/pulls?state=open&per_page=${limit}`
        : `${base}/issues?state=open&per_page=${limit}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "nova-assistant",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    return `Ağ hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
  }

  if (!res.ok) {
    if (res.status === 404) return `Depo bulunamadı: ${owner}/${repo}`;
    if (res.status === 401 || res.status === 403)
      return `GitHub erişim hatası (${res.status}). GITHUB_TOKEN eksik/geçersiz olabilir ya da oran limiti aşıldı.`;
    return `GitHub hatası: HTTP ${res.status}`;
  }

  const data = (await res.json()) as unknown[];

  if (kind === "commits") {
    const rows = (data as Array<{ sha: string; commit: { message: string; author?: { name?: string } } }>).map(
      (c) =>
        `- ${c.sha.slice(0, 7)} ${c.commit.message.split("\n")[0]}${
          c.commit.author?.name ? ` (${c.commit.author.name})` : ""
        }`,
    );
    return rows.length ? rows.join("\n") : "Commit bulunamadı.";
  }

  // pulls / issues — issues endpoint PR'ları da döndürür, onları ele
  const items = (data as Array<{ number: number; title: string; user?: { login?: string }; pull_request?: unknown }>)
    .filter((x) => (kind === "issues" ? !x.pull_request : true))
    .map((x) => `- #${x.number} ${x.title}${x.user?.login ? ` (@${x.user.login})` : ""}`);

  return items.length
    ? items.join("\n")
    : kind === "pulls"
      ? "Açık PR yok."
      : "Açık issue yok.";
}
