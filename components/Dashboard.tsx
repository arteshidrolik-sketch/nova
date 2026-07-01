"use client";

import { useEffect, useState } from "react";

// Sohbetin yanındaki boşluğu dolduran canlı bilgi panosu:
// tarih-saat, hava durumu, günlük euro/dolar kuru.

type Weather = { temp: number; code: number; city: string } | null;
type Rates = { eur: number | null; usd: number | null; date: string } | null;

// WMO hava kodu → Türkçe açıklama + emoji
function wmo(code: number): { label: string; icon: string } {
  if (code === 0) return { label: "Açık", icon: "☀️" };
  if (code <= 2) return { label: "Az bulutlu", icon: "🌤️" };
  if (code === 3) return { label: "Bulutlu", icon: "☁️" };
  if (code <= 48) return { label: "Sisli", icon: "🌫️" };
  if (code <= 57) return { label: "Çisenti", icon: "🌦️" };
  if (code <= 67) return { label: "Yağmurlu", icon: "🌧️" };
  if (code <= 77) return { label: "Karlı", icon: "❄️" };
  if (code <= 82) return { label: "Sağanak", icon: "🌧️" };
  if (code <= 86) return { label: "Kar sağanağı", icon: "🌨️" };
  return { label: "Gök gürültülü", icon: "⛈️" };
}

export default function Dashboard() {
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<Weather>(null);
  const [rates, setRates] = useState<Rates>(null);

  // Canlı saat
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Hava durumu — konum izni varsa oradan, yoksa İstanbul
  useEffect(() => {
    let done = false;
    const load = async (lat: number, lon: number, fallbackCity: string) => {
      try {
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
        ).then((r) => r.json());
        let city = fallbackCity;
        try {
          const g = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=tr`,
          ).then((r) => r.json());
          city = g.city || g.locality || g.principalSubdivision || fallbackCity;
        } catch {}
        if (!done && w?.current_weather) {
          setWeather({
            temp: Math.round(w.current_weather.temperature),
            code: w.current_weather.weathercode,
            city,
          });
        }
      } catch {}
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude, "Konumun"),
        () => load(41.0082, 28.9784, "İstanbul"),
        { timeout: 8000 },
      );
    } else {
      load(41.0082, 28.9784, "İstanbul");
    }
    return () => {
      done = true;
    };
  }, []);

  // Günlük kur (ECB / frankfurter — anahtarsız)
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch(
          "https://api.frankfurter.app/latest?base=EUR&symbols=TRY",
        ).then((r) => r.json());
        const usd = await fetch(
          "https://api.frankfurter.app/latest?base=USD&symbols=TRY",
        ).then((r) => r.json());
        setRates({
          eur: d?.rates?.TRY ?? null,
          usd: usd?.rates?.TRY ?? null,
          date: d?.date ?? "",
        });
      } catch {}
    })();
  }, []);

  const w = weather ? wmo(weather.code) : null;
  const fmtTRY = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {/* Saat & tarih — küçük, tek satır */}
      <div className="flex items-center justify-between rounded-xl border border-violet-400/40 bg-gradient-to-r from-indigo-500/25 to-fuchsia-500/20 px-3 py-2 shadow-[0_0_20px_-12px_rgba(167,139,250,0.7)]">
        <span className="text-base font-semibold tabular-nums text-violet-100">
          {now
            ? now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "--:--:--"}
        </span>
        <span className="text-xs font-medium text-violet-200/70">
          {now
            ? now.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "long" })
            : ""}
        </span>
      </div>

      {/* Hava durumu */}
      <div className="flex items-center gap-3 rounded-2xl border border-sky-400/40 bg-gradient-to-br from-sky-500/30 via-cyan-500/20 to-blue-500/25 p-4 shadow-[0_0_35px_-12px_rgba(56,189,248,0.7)]">
        <div className="text-5xl drop-shadow-[0_0_10px_rgba(56,189,248,0.6)]">{w ? w.icon : "…"}</div>
        <div className="min-w-0">
          <div className="text-3xl font-bold text-sky-50">
            {weather ? `${weather.temp}°C` : "—"}
          </div>
          <div className="truncate text-sm font-medium text-sky-100/80">
            {weather ? `${w?.label} · ${weather.city}` : "Hava durumu yükleniyor…"}
          </div>
        </div>
      </div>

      {/* Kurlar */}
      <div className="rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/30 via-teal-500/20 to-green-500/25 p-4 shadow-[0_0_35px_-12px_rgba(52,211,153,0.7)]">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
          <span>Günlük Kur</span>
          <span>{rates?.date || ""}</span>
        </div>
        <div className="flex items-baseline justify-between border-b border-white/10 py-1.5">
          <span className="font-medium text-emerald-50">🇪🇺 Euro</span>
          <span className="text-xl font-bold tabular-nums text-amber-300">₺{fmtTRY(rates?.eur ?? null)}</span>
        </div>
        <div className="flex items-baseline justify-between py-1.5">
          <span className="font-medium text-emerald-50">🇺🇸 Dolar</span>
          <span className="text-xl font-bold tabular-nums text-lime-300">₺{fmtTRY(rates?.usd ?? null)}</span>
        </div>
      </div>

      <div className="mt-auto text-center text-[11px] text-white/40">
        Hava: open-meteo · Kur: ECB (frankfurter)
      </div>
    </div>
  );
}
