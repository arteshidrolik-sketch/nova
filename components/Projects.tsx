"use client";

import { useCallback, useEffect, useState } from "react";

type Project = {
  id: string;
  name: string;
  path: string;
  repoUrl?: string;
};

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/projects");
      const d = await r.json();
      setProjects(d.projects ?? []);
      setActiveId(d.activeId ?? null);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addProject() {
    if (!name.trim() || !path.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path, repoUrl }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d?.message || "Eklenemedi (klasör yolu doğru mu?)");
        return;
      }
      setName("");
      setPath("");
      setRepoUrl("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function op(id: string, o: string) {
    await fetch(`/api/projects/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: o }),
    });
    refresh();
  }

  const inputStyle = {
    borderColor: "var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
  };

  return (
    <div className="flex h-full flex-col">
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <h1 className="text-lg font-semibold">Projeler</h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Bir proje klasörünü bağla — aktif projede ajanlar dosyaları okur ve
          (GO ile) düzenler
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* yeni proje */}
          <div
            className="space-y-2 rounded-xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
          >
            <div className="text-sm font-medium">Proje ekle</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Proje adı (örn. GetDriver)"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Yerel klasör yolu (örn. C:\Users\info\...\getdriver)"
              className="w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
              style={inputStyle}
            />
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="(Opsiyonel) GitHub URL"
              className="w-full rounded-lg border px-3 py-2 text-xs outline-none"
              style={inputStyle}
            />
            {error && (
              <div className="text-xs" style={{ color: "#ef4444" }}>
                {error}
              </div>
            )}
            <button
              onClick={addProject}
              disabled={busy || !name.trim() || !path.trim()}
              className="btn-grad rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              style={{ background: "var(--grad)" }}
            >
              {busy ? "Ekleniyor…" : "+ Ekle"}
            </button>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              GitHub repon önce lokale klonlanmalı. Klonlamadıysan bana repo
              URL&apos;ini söyle, ben klonlayıp buraya ekleyeyim.
            </p>
          </div>

          {projects.length === 0 && (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
              }}
            >
              Henüz proje yok.
            </div>
          )}

          {projects.map((p) => {
            const isActive = p.id === activeId;
            return (
              <div
                key={p.id}
                className="card rounded-xl border p-4"
                style={{
                  borderColor: isActive ? "var(--accent)" : "var(--border)",
                  background: "var(--bg-panel)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {isActive && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-bold"
                      style={{ color: "#10b981", background: "#10b9811a" }}
                    >
                      AKTİF
                    </span>
                  )}
                  <div className="ml-auto flex gap-2">
                    {!isActive && (
                      <button
                        onClick={() => op(p.id, "activate")}
                        className="rounded-lg px-3 py-1 text-xs font-medium text-black"
                        style={{ background: "var(--accent)" }}
                      >
                        Aktif yap
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`"${p.name}" listeden kaldırılsın mı? (dosyalar silinmez)`))
                          op(p.id, "remove");
                      }}
                      className="text-xs"
                      style={{ color: "#ef4444" }}
                    >
                      kaldır
                    </button>
                  </div>
                </div>
                <div
                  className="mt-1 font-mono text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {p.path}
                </div>
                {p.repoUrl && (
                  <a
                    href={p.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {p.repoUrl}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
