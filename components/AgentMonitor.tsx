"use client";

// Ajan performans paneli (Ekip sekmesinin sağ sütunu): anlık takip.
// - Şu an: hangi uzman çalışıyor, hangi modelle, ne kadar süredir
// - Canlı akış: bu isteğin olayları (görev, araç, hata, revizyon, teslim) zamanıyla
// - Karne (son 30 gün, /api/team/log): uzman başına iş, ilk seferde kabul,
//   ortalama süre, maliyet, hata; son düzeltmeler, hatalar ve seviye önerileri
import { useCallback, useEffect, useRef, useState } from "react";
import { TEAM_META, teamCast, type TeamRole } from "@/lib/team/roles";

type LogEntry = {
  ts: number; role: string; person: string; chosen: string; tier: string; revision: number;
  task: string; sec: number; costUsd: number; actions: number; errors?: string[]; failed?: boolean; note?: string;
};
type Ev = { t: number; icon: string; text: string; kind: "work" | "done" | "rev" | "err" | "tool" | "info" };

const TIER_LABEL: Record<string, string> = { hafif: "Haiku", standart: "Sonnet", agir: "Opus" };
const TIER_COLOR: Record<string, string> = { Haiku: "#2ff5b5", Sonnet: "#7aa2ff", Opus: "#ff7ad9", hafif: "#2ff5b5", standart: "#7aa2ff", agir: "#ff7ad9" };
const KIND_COLOR: Record<Ev["kind"], string> = { work: "#7aa2ff", done: "#2ff5b5", rev: "#ffb547", err: "#ff6b7a", tool: "#9d9d9d", info: "#9d9d9d" };
const SPECIALISTS: TeamRole[] = ["research", "coder", "marketing"];

type Totals = { input: number; cacheWrite: number; cacheRead: number; output: number; usd: number; calls: number };
type ProjUsage = { since: number | null; total: Totals; roles: Partial<Record<TeamRole | "direct", Totals>> };
const tokOf = (t?: Totals) => (t ? t.input + t.cacheWrite + t.cacheRead + t.output : 0);
function fmtTok(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}M`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}K`;
  return String(n);
}
const fmtUsd = (n: number) => "$" + (n < 10 ? n.toFixed(3) : n.toFixed(2));

// Akış metnindeki ekip satırlarını olaylara çevir
function parseEvents(text: string): { icon: string; text: string; kind: Ev["kind"] }[] {
  const out: { icon: string; text: string; kind: Ev["kind"] }[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("👥") && l.includes("teslim etti")) out.push({ icon: "✅", text: l.replace(/^👥\s*/, "").replace(/ — 👔.*$/, ""), kind: "done" });
    else if (l.startsWith("👥")) out.push({ icon: "▶", text: l.replace(/^👥\s*/, ""), kind: "work" });
    else if (l.startsWith("👔")) out.push({ icon: "↻", text: l.replace(/^👔\s*/, ""), kind: "rev" });
    else if (l.startsWith("❌") || l.startsWith("⚠️")) out.push({ icon: "✖", text: l.replace(/^(❌|⚠️)\s*/u, ""), kind: "err" });
    else if (l.startsWith("⚙️")) out.push({ icon: "⚙", text: l.replace(/^⚙️\s*/u, ""), kind: "tool" });
    else if (l.startsWith("🌐") || l.startsWith("⏳") || l.startsWith("🛡️")) out.push({ icon: l.slice(0, 2), text: l.replace(/^\S+\s*/u, ""), kind: "info" });
  }
  return out;
}

function fmtSec(s: number) { return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`; }
function fmtTime(t: number) { return new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

export default function AgentMonitor({ convId }: { convId: string }) {
  const cast = teamCast(convId);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<Ev[]>([]);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [usage, setUsage] = useState<ProjUsage | null>(null);
  const loadUsage = useCallback(() => {
    fetch(`/api/team/usage?scope=${encodeURIComponent(convId)}`).then((r) => r.json())
      .then((d) => { if (d?.total) setUsage(d); }).catch(() => {});
  }, [convId]);
  useEffect(() => { loadUsage(); }, [loadUsage]);
  const seen = useRef(0); // bu istekte işlenen olay sayısı
  const wasRunning = useRef(false);

  const loadLog = useCallback(() => {
    fetch(`/api/team/log?scope=${encodeURIComponent(convId)}&days=30`).then((r) => r.json())
      .then((d) => setLog(Array.isArray(d.entries) ? d.entries : [])).catch(() => setLog([]));
  }, [convId]);
  useEffect(() => { loadLog(); }, [loadLog]);

  useEffect(() => {
    const onStream = (e: Event) => {
      const d = (e as CustomEvent<{ convId: string; text: string; running: boolean }>).detail;
      if (!d || d.convId !== convId) return;
      if (d.running && !wasRunning.current) { seen.current = 0; setEvents([]); setStartAt(Date.now()); }
      const parsed = parseEvents(d.text);
      if (parsed.length > seen.current) {
        const fresh = parsed.slice(seen.current).map((p) => ({ ...p, t: Date.now() }));
        seen.current = parsed.length;
        setEvents((prev) => [...prev, ...fresh]);
      }
      if (!d.running && wasRunning.current) { setTimeout(loadLog, 1500); setTimeout(loadUsage, 1500); } // kayıt yazılsın, karneyi tazele
      wasRunning.current = d.running;
      setRunning(d.running);
    };
    window.addEventListener("nova:stream", onStream);
    return () => window.removeEventListener("nova:stream", onStream);
  }, [convId, loadLog, loadUsage]);

  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    const u = setInterval(loadUsage, 4000); // çalışırken sayaç canlı artsın
    return () => { clearInterval(i); clearInterval(u); };
  }, [running, loadUsage]);

  // Şu an çalışan uzman: son "work" olayından sonra "done" gelmemişse
  let active: { text: string; t: number } | null = null;
  for (const ev of events) {
    if (ev.kind === "work") active = { text: ev.text, t: ev.t };
    else if (ev.kind === "done") active = null;
  }
  const liveErrors = events.filter((e) => e.kind === "err").length;
  const liveRevs = events.filter((e) => e.kind === "rev").length;

  // Karne
  const entries = log ?? [];
  const card = SPECIALISTS.map((r) => {
    const es = entries.filter((e) => e.role === r);
    const tasks = es.filter((e) => e.revision === 0).length;
    const revised = new Set<number>();
    // ilk seferde kabul: revizyon 0 sonrası aynı uzmana revizyon gelmemiş görevler
    const sorted = [...es].sort((a, b) => a.ts - b.ts);
    let cur = -1;
    for (const e of sorted) { if (e.revision === 0) cur = e.ts; else if (cur >= 0) revised.add(cur); }
    const firstTry = tasks ? Math.round(((tasks - revised.size) / tasks) * 100) : null;
    const avg = es.length ? Math.round(es.reduce((a, e) => a + e.sec, 0) / es.length) : 0;
    const cost = es.reduce((a, e) => a + e.costUsd, 0);
    const errs = es.reduce((a, e) => a + (e.errors?.length ?? 0) + (e.failed ? 1 : 0), 0);
    const tiers: Record<string, number> = {};
    for (const e of es) tiers[TIER_LABEL[e.tier] ?? e.tier] = (tiers[TIER_LABEL[e.tier] ?? e.tier] ?? 0) + 1;
    return { r, tasks, firstTry, avg, cost, errs, tiers };
  });
  const totalCost = entries.reduce((a, e) => a + e.costUsd, 0);
  const fixes = entries.filter((e) => e.revision > 0 && e.note).slice(0, 8);
  const errors = entries.flatMap((e) => [
    ...(e.failed && !(e.errors ?? []).length ? [{ ts: e.ts, person: e.person, text: "Teslim metni üretemedi" }] : []),
    ...(e.errors ?? []).map((x) => ({ ts: e.ts, person: e.person, text: x })),
  ]).slice(0, 8);
  const flags = suggestions(entries);

  return (
    <aside className="surface-dark flex h-full min-h-0 flex-col" style={{ background: "#181818", borderLeft: "1px solid var(--border)" }} aria-label="Ajan performansı">
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="text-[14px] font-semibold">Ajan performansı</div>
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: running ? "#2ff5b5" : "var(--text-muted)" }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: running ? "#2ff5b5" : "#555", boxShadow: running ? "0 0 8px #2ff5b5" : "none" }} />
          {running ? "Canlı" : "Beklemede"}
        </span>
      </div>

      {/* Proje token sayacı (sabit) */}
      <div className="shrink-0 px-4 py-3 text-[13px]" style={{ borderBottom: "1px solid var(--border)", background: "#1b1b1b" }}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".06em" }}>Proje boyunca</div>
          {usage?.since && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>sayım başlangıcı: {new Date(usage.since).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</div>}
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[22px] font-semibold tabular-nums">{fmtTok(tokOf(usage?.total))}</span>
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>token</span>
          <span className="ml-auto text-[18px] font-semibold tabular-nums" style={{ color: "#2ff5b5" }}>{fmtUsd(usage?.total.usd ?? 0)}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(["manager", "research", "coder", "marketing"] as TeamRole[]).map((r) => {
            const t = usage?.roles[r];
            return (
              <div key={r} className="rounded-md px-2 py-1.5" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }} title={t ? `${TEAM_META[r].name}: girdi ${t.input}, önbellek yazma ${t.cacheWrite}, önbellek okuma ${t.cacheRead}, çıktı ${t.output} · ${t.calls} çağrı` : TEAM_META[r].name}>
                <div className="truncate text-[11px]" style={{ color: TEAM_META[r].color }}>{cast[r].name}</div>
                <div className="font-semibold tabular-nums">{fmtTok(tokOf(t))}</div>
                <div className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtUsd(t?.usd ?? 0)}</div>
              </div>
            );
          })}
        </div>
        {usage?.roles.direct && tokOf(usage.roles.direct) > 0 && (
          <div className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>Ekip dışı (doğrudan) sohbet: {fmtTok(tokOf(usage.roles.direct))} · {fmtUsd(usage.roles.direct.usd)}</div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
        {/* Şu an */}
        <Section title="Şu an">
          {running ? (
            <div className="rounded-lg p-3" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div className="font-medium">{active ? active.text.split(":")[0] : "👔 Müdür planlıyor / denetliyor"}</div>
              {active && <div className="mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>{active.text.split(":").slice(1).join(":").trim()}</div>}
              <div className="mt-2 flex gap-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                <span>⏱ {fmtSec(Math.max(0, Math.round((now - (active?.t ?? startAt ?? now)) / 1000)))}</span>
                <span>Toplam {fmtSec(Math.max(0, Math.round((now - (startAt ?? now)) / 1000)))}</span>
                {liveRevs > 0 && <span style={{ color: "#ffb547" }}>↻ {liveRevs}</span>}
                {liveErrors > 0 && <span style={{ color: "#ff6b7a" }}>✖ {liveErrors}</span>}
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)" }}>Ekip boşta. Müdüre bir iş verdiğinde burada anlık izlenir.</div>
          )}
        </Section>

        {/* Canlı akış */}
        {events.length > 0 && (
          <Section title={running ? "Canlı akış" : "Son istek"}>
            <ol className="flex flex-col gap-1.5">
              {events.slice(-30).map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-[58px] shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtTime(e.t).slice(0, 8)}</span>
                  <span className="w-3 shrink-0 text-center" style={{ color: KIND_COLOR[e.kind] }}>{e.icon}</span>
                  <span className="min-w-0 break-words" style={{ color: e.kind === "tool" || e.kind === "info" ? "var(--text-muted)" : "var(--text)" }}>{e.text}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Karne */}
        <Section title="Karne · son 30 gün" right={entries.length ? `~$${totalCost.toFixed(3)}` : undefined}>
          {log === null ? (
            <div style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>
          ) : entries.length === 0 ? (
            <div style={{ color: "var(--text-muted)" }}>Henüz kayıt yok. Uzmanlar iş yaptıkça doluyor.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {card.map((c) => (
                <div key={c.r} className="rounded-lg p-3" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium">{cast[c.r].name} <span className="text-[12px] font-normal" style={{ color: TEAM_META[c.r].color }}>{TEAM_META[c.r].name}</span></div>
                    <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{c.tasks} iş</div>
                  </div>
                  {c.tasks > 0 && (
                    <>
                      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[12px]">
                        <Stat label="1. sefer" value={c.firstTry === null ? "—" : `%${c.firstTry}`} color={c.firstTry !== null && c.firstTry < 60 ? "#ffb547" : undefined} />
                        <Stat label="Ort. süre" value={fmtSec(c.avg)} />
                        <Stat label="Hata" value={String(c.errs)} color={c.errs ? "#ff6b7a" : undefined} />
                        <Stat label="Maliyet" value={`$${c.cost.toFixed(3)}`} />
                      </div>
                      <div className="mt-2 flex gap-1">
                        {Object.entries(c.tiers).map(([k, v]) => (
                          <span key={k} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--chip-bg)", color: TIER_COLOR[k] }}>{k} ×{v}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {flags.length > 0 && (
          <Section title="Seviye önerileri">
            <ul className="flex flex-col gap-1.5">{flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </Section>
        )}

        {fixes.length > 0 && (
          <Section title="Düzeltmeler (müdürün revizyonları)">
            <ul className="flex flex-col gap-2">
              {fixes.map((e, i) => (
                <li key={i}>
                  <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{new Date(e.ts).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {e.person} · rev {e.revision} · <span style={{ color: TIER_COLOR[e.tier] }}>{TIER_LABEL[e.tier]}</span></div>
                  <div style={{ color: "#ffb547" }}>{e.note}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {errors.length > 0 && (
          <Section title="Hatalar">
            <ul className="flex flex-col gap-2">
              {errors.map((e, i) => (
                <li key={i}>
                  <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{new Date(e.ts).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {e.person}</div>
                  <div className="break-words" style={{ color: "#ff6b7a" }}>{e.text}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".06em" }}>
        <span>{title}</span>{right && <span className="normal-case">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="font-semibold" style={{ color: color ?? "var(--text)" }}>{value}</div>
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// Seviye önerileri (sunucudaki flagEntries ile aynı ölçüt, istemci tarafı)
function suggestions(entries: LogEntry[]): string[] {
  const out: string[] = [];
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const groups: LogEntry[][] = [];
  const open: Record<string, LogEntry[]> = {};
  for (const e of sorted) {
    if (e.revision === 0 || !open[e.role]) { open[e.role] = [e]; groups.push(open[e.role]); } else open[e.role].push(e);
  }
  for (const g of groups.reverse()) {
    const f = g[0], revs = g.length - 1, label = `${f.person}: "${f.task.slice(0, 50)}"`;
    if (f.chosen === "hafif" && revs >= 2) out.push(`⬆️ ${label} — Haiku ${revs} revizyon gerektirdi, Sonnet daha uygun olabilirdi`);
    if (f.chosen === "agir" && revs === 0 && f.sec < 40 && f.actions <= 1) out.push(`⬇️ ${label} — Opus ${f.sec} sn'de bitti, daha ucuz model yetebilirdi`);
    if (g.some((e) => e.tier !== e.chosen)) out.push(`↗️ ${label} — revizyonda takıldı, seviye otomatik yükseltildi`);
    if (out.length >= 6) break;
  }
  return out;
}
