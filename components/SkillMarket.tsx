"use client";

// Hazır beceri bul (skills.sh / açık beceri ekosistemi): ara → önizle → ajan seç → ekle.
// Üçüncü taraf beceriler ajanların uyacağı talimatlardır; eklemeden önce içerik gösterilir,
// kurulum sayısı ve kaynak görünür (az kurulmuş / tanınmayan kaynakta uyarı).
import { useState } from "react";

type Hit = { name: string; source: string; skillId: string; installs: number };
type Preview = { name: string; description: string; content: string; path: string; source: string };
const ROLES: [string, string][] = [["manager", "Müdür"], ["research", "Araştırma"], ["coder", "Kod"], ["marketing", "Satış & Pazarlama"]];
const TRUSTED = /^(anthropics|vercel-labs|vercel|microsoft|google|openai|higgsfield-ai|supabase|stripe)\//i;

export default function SkillMarket({ onAdded }: { onAdded?: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [pv, setPv] = useState<(Preview & { hit: Hit }) | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [done, setDone] = useState("");

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setBusy("search"); setErr(""); setDone(""); setPv(null);
    // "sahip/depo" ya da GitHub bağlantısı yazıldıysa doğrudan o depodaki becerileri listele
    const isRepo = /github\.com\/|^[\w.-]+\/[\w.-]+$/.test(term);
    const url = isRepo ? `/api/skills/remote?source=${encodeURIComponent(term)}` : `/api/skills/remote?q=${encodeURIComponent(term)}`;
    const r = await fetch(url).then((x) => x.json()).catch(() => ({ error: "bağlantı hatası" }));
    if (r.error) { setErr(r.error); setHits([]); }
    else if (isRepo) setHits((r.skills as { skillId: string }[]).map((s) => ({ name: s.skillId, source: term.replace(/^https?:\/\/github\.com\//, "").split(/[/?#]/).slice(0, 2).join("/"), skillId: s.skillId, installs: -1 })));
    else setHits(r.skills);
    setBusy("");
  };

  const preview = async (h: Hit) => {
    setBusy(h.skillId); setErr(""); setDone(""); setRoles([]);
    const r = await fetch("/api/skills/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: h.source, skillId: h.skillId }) }).then((x) => x.json()).catch(() => ({ error: "bağlantı hatası" }));
    if (r.error) setErr(r.error); else setPv({ ...r, hit: h });
    setBusy("");
  };

  const install = async () => {
    if (!pv || !roles.length) return;
    setBusy("install"); setErr("");
    const r = await fetch("/api/skills/remote", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: pv.hit.source, skillId: pv.hit.skillId, roles }) }).then((x) => x.json()).catch(() => ({ error: "bağlantı hatası" }));
    if (r.error) setErr(r.error);
    else { setDone(`"${pv.name}" eklendi → ${roles.map((x) => ROLES.find((y) => y[0] === x)?.[1]).join(", ")}`); setPv(null); onAdded?.(); }
    setBusy("");
  };

  const box = { borderColor: "var(--border)", background: "var(--bg-panel)" };
  const input = { borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" };
  return (
    <section className="mx-6 mt-4 rounded-xl border p-4" style={box}>
      <div className="mb-1 text-sm font-semibold">Hazır beceri bul <span className="font-normal" style={{ color: "var(--text-muted)" }}>· skills.sh açık beceri kataloğu</span></div>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Konu yaz (ör. <i>youtube</i>, <i>seo</i>, <i>nextjs</i>) ya da bir GitHub deposu (<i>sahip/depo</i>). Önizle, hangi ajana yükleneceğini seç, ekle.
      </p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="ara…"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none" style={input} />
        <button onClick={search} disabled={busy !== "" || q.trim().length < 2} className="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
          {busy === "search" ? "Aranıyor…" : "Ara"}
        </button>
      </div>
      {err && <div className="mt-2 text-xs" style={{ color: "#ff6b7a" }}>{err}</div>}
      {done && <div className="mt-2 text-xs" style={{ color: "#2ff5b5" }}>✓ {done}</div>}

      {hits && !pv && (
        <ul className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
          {hits.length === 0 && <li className="text-xs" style={{ color: "var(--text-muted)" }}>Sonuç yok.</li>}
          {hits.map((h) => (
            <li key={h.source + h.skillId} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <div className="min-w-0">
                <div className="truncate font-medium">{h.name}</div>
                <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {h.source}{h.installs >= 0 && <> · {h.installs.toLocaleString("tr-TR")} kurulum</>}
                  {TRUSTED.test(h.source + "/") && <span style={{ color: "#2ff5b5" }}> · resmî kaynak</span>}
                  {h.installs >= 0 && h.installs < 100 && <span style={{ color: "#ffb547" }}> · az kurulmuş, dikkat</span>}
                </div>
              </div>
              <button onClick={() => preview(h)} disabled={busy !== ""} className="shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-40" style={input}>
                {busy === h.skillId ? "…" : "Önizle"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pv && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-semibold">{pv.name} <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{pv.source}</span></div>
            <button onClick={() => setPv(null)} className="text-xs underline" style={{ color: "var(--text-muted)" }}>geri</button>
          </div>
          {pv.description && <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{pv.description}</p>}
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-xs" style={input}>{pv.content.slice(0, 6000)}{pv.content.length > 6000 ? "\n…" : ""}</pre>
          <p className="mt-2 text-xs" style={{ color: "#ffb547" }}>Bu metin seçtiğin ajanın talimatı olacak. Okuyup güvendiysen ekle.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ROLES.map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs" style={input}>
                <input type="checkbox" checked={roles.includes(k)} onChange={() => setRoles((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]))} />
                {label}
              </label>
            ))}
            <button onClick={install} disabled={busy !== "" || !roles.length} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40" style={{ background: "var(--grad)", color: "#0b1030" }}>
              {busy === "install" ? "Ekleniyor…" : "Ajanlara ekle"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
