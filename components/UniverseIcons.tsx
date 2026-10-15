// Evren / proje sayfası için tek dilli SVG ikon seti (24×24, 2px çizgi, currentColor).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { title?: string };
function Base({ title, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconChat = (p: P) => (
  <Base {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></Base>
);
export const IconFolder = (p: P) => (
  <Base {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Base>
);
export const IconMemory = (p: P) => (
  <Base {...p}>
    <path d="M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3 3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Z" />
    <path d="M15 4a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 10a3 3 0 0 1-1 2.2A3 3 0 0 1 18 17a3 3 0 0 1-3 3 3 3 0 0 1-3-3" />
  </Base>
);
export const IconSkill = (p: P) => (
  <Base {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></Base>
);
export const IconAgent = (p: P) => (
  <Base {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" />
  </Base>
);
export const IconTasks = (p: P) => (
  <Base {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></Base>
);
export const IconBack = (p: P) => (
  <Base {...p}><path d="M15 18l-6-6 6-6" /></Base>
);
export const IconPlus = (p: P) => (
  <Base {...p}><path d="M12 5v14M5 12h14" /></Base>
);
export const IconExpand = (p: P) => (
  <Base {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Base>
);
export const IconShrink = (p: P) => (
  <Base {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Base>
);
export const IconMusic = (p: P) => (
  <Base {...p}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></Base>
);
export const IconMusicOff = (p: P) => (
  <Base {...p}><path d="M9 18V9M9 5l11-2v9" /><circle cx="6" cy="18" r="3" /><path d="M3 3l18 18" /></Base>
);
export const IconReport = (p: P) => (
  <Base {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></Base>
);
export const IconGrid = (p: P) => (
  <Base {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Base>
);
export const IconInvoice = (p: P) => (
  <Base {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></Base>
);
export const IconClose = (p: P) => (
  <Base {...p}><path d="M6 6l12 12M18 6 6 18" /></Base>
);
