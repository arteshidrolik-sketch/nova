"use client";

import type { CSSProperties, ReactNode } from "react";

// Tutarlı çizgi-tabanlı SVG ikon seti (emoji yerine — Blueprint 5.6).
// Hepsi currentColor stroke; renk ebeveynden gelir.
export type IconName =
  | "harita"
  | "brifing"
  | "tasks"
  | "projeler"
  | "beceriler"
  | "surumler"
  | "loops"
  | "guardrail"
  | "denetim"
  | "ayarlar";

const PATHS: Record<IconName, ReactNode> = {
  // Çalışma alanı — bağlı düğümler (ajan haritası)
  harita: (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v2.5M11 10.5 6.5 17M13 10.5 17.5 17" />
    </>
  ),
  // Brifing — pano/liste
  brifing: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  // Görevler — işaretli liste
  tasks: (
    <>
      <path d="m3 7 1.5 1.5L8 5" />
      <path d="m3 16 1.5 1.5L8 14" />
      <path d="M12 7h9M12 16h9" />
    </>
  ),
  // Projeler — klasör
  projeler: (
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  ),
  // Beceriler — katmanlar
  beceriler: (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    </>
  ),
  // Sürümler — paket
  surumler: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  // Loops — tekrar
  loops: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  // Kontrol — kalkan
  guardrail: (
    <path d="M12 22c4.5-1.5 8-4.5 8-9.5V6a1 1 0 0 0-1-1c-2 0-4.5-1.2-6.24-2.72a1.17 1.17 0 0 0-1.52 0C9.5 3.8 7 5 5 5a1 1 0 0 0-1 1v6.5c0 5 3.5 8 8 9.5Z" />
  ),
  // Denetim — belge/metin
  denetim: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 13h6M9 17h6M9 9h1" />
    </>
  ),
  // Ayarlar — sürgüler
  ayarlar: (
    <>
      <path d="M4 21v-6M4 11V3M12 21v-8M12 9V3M20 21v-4M20 13V3" />
      <path d="M2 15h4M10 9h4M18 17h4" />
    </>
  ),
};

export default function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
