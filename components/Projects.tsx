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

  // Gözat (sunucu klasör gezgini)
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseErr, setBrowseErr] = useState("");

  async function loadBrowse(p: string) {
    setBrowseErr("");
    try {
      const r = await fetch(`/api/projects/browse?path=${encodeURIComponent(p)}`);
      const d = await r.json();
      setBrowsePath(d.path ?? p);
      setBrowseParent(d.parent ?? null);
      setBrowseDirs(d.dirs ?? []);
      if (d.error) setBrowseErr(d.error);
    } catch {
      setBrowseErr("Klasör okunamadı");
    }
  }

  async function openBrowse() {
    setBrowseOpen(true);
    await loadBrowse(path.trim() || "/srv/projects");
  }

  function chooseFolder() {
    setPath(browsePath);
    if (!name.trim()) {
      const base = browsePath.split(/[\\/]/).filter(Boolean).pop() || "";
      setName(base);
    }
    setBrowseOpen(false);
  }

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
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Sunucu klasör yolu (örn. /srv/projects/getdriver)"
                className="flex-1 rounded-lg border px-3 py-2 font-mono text-xs outline-none"
                style={inputStyle}
              />
              <button
                onClick={openBrowse}
                type="button"
                className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                title="Sunucudan klasör seç"
              >
                📂 Gözat
              </button>
            </div>
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

      {/* Gözat penceresi — sunucu klasör gezgini */}
      {browseOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setBrowseOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">Klasör seç</div>
              <button
                onClick={() => setBrowseOpen(false)}
                className="text-sm opacity-70"
              >
                ✕
              </button>
            </div>
            <div
              className="mb-2 truncate font-mono text-xs"
              style={{ color: "var(--text-muted)" }}
              title={browsePath}
            >
              {browsePath || "…"}
            </div>
            {browseErr && (
              <div className="mb-2 text-xs" style={{ color: "#f59e0b" }}>
                {browseErr}
              </div>
            )}
            <div
              className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              {browseParent && (
                <button
                  onClick={() => loadBrowse(browseParent)}
                  className="nav-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                >
                  ⬆️ .. (üst klasör)
                </button>
              )}
              {browseDirs.length === 0 && (
                <div className="px-2 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Alt klasör yok.
                </div>
              )}
              {browseDirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => loadBrowse(d.path)}
                  className="nav-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                >
                  📁 {d.name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setBrowseOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                İptal
              </button>
              <button
                onClick={chooseFolder}
                className="btn-grad rounded-lg px-4 py-1.5 text-sm font-medium text-black"
                style={{ background: "var(--grad)" }}
              >
                ✓ Bu klasörü seç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
