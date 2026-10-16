"use client";

// Üst çubuktaki Nova toplam maliyet göstergesi: tüm projelerin (ve ekip dışı
// işlerin) tüm zamanlar harcaması — token, USD ve günlük kurla TL; yanında bugün.
// 30 sn'de bir ve her istek bitince tazelenir.
import { useCallback, useEffect, useState } from "react";

type Totals = {
  allTime: { tokens: number; usd: number; requests: number; since: string };
  month: { tokens: number; usd: number };
  today: { tokens: number; usd: number; requests: number };
};

function fmtTok(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}K`;
  return String(n);
}
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tl = (n: number, rate: number) => "₺" + (n * rate).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export default function NovaCost() {
  const [t, setT] = useState<Totals | null>(null);
  const [rate, setRate] = useState(0);
  const load = useCallback(() => {
    fetch("/api/usage").then((r) => r.json()).then((d) => { if (d?.allTime) setT(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    fetch("/api/fx").then((r) => r.json()).then((d) => { if (d?.usdTry > 0) setRate(d.usdTry); }).catch(() => {});
    const i = setInterval(load, 30000);
    const onStream = (e: Event) => { if ((e as CustomEvent<{ running: boolean }>).detail?.running === false) setTimeout(load, 1500); };
    window.addEventListener("nova:stream", onStream);
    return () => { clearInterval(i); window.removeEventListener("nova:stream", onStream); };
  }, [load]);
  if (!t) return null;
  const since = new Date(`${t.allTime.since}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div
      className="hidden items-center gap-3 rounded-xl px-3 py-1.5 md:flex"
      style={{ background: "rgba(0,0,0,.28)", border: "1px solid var(--border-strong)" }}
      title={`Nova'nın tüm projelerdeki toplam API harcaması (${since} itibarıyla, ${t.allTime.requests.toLocaleString("tr-TR")} istek). Bu ay: ${usd(t.month.usd)} · ${fmtTok(t.month.tokens)} token. Tutarlar tahminidir.`}
    >
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".08em" }}>Nova toplam</div>
        <div className="text-[13px] tabular-nums">
          <b>{usd(t.allTime.usd)}</b>
          {rate > 0 && <span style={{ color: "#ffd166" }}> ≈ {tl(t.allTime.usd, rate)}</span>}
          <span style={{ color: "var(--text-muted)" }}> · {fmtTok(t.allTime.tokens)} token</span>
        </div>
      </div>
      <div className="h-7 w-px" style={{ background: "var(--border-strong)" }} />
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".08em" }}>Bugün</div>
        <div className="text-[13px] tabular-nums">
          <b style={{ color: "#2ff5b5" }}>{usd(t.today.usd)}</b>
          {rate > 0 && <span style={{ color: "#ffd166" }}> ≈ {tl(t.today.usd, rate)}</span>}
        </div>
      </div>
    </div>
  );
}
