import type { Metadata, Viewport } from "next";
import { Noto_Color_Emoji, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Emoji fontu — VPS'te sistem emoji fontu olmadığı için başlık/buton
// emoji'leri kırık kutu (□) çıkıyordu. Bu web font ile her yerde düzgün render olur.
const notoEmoji = Noto_Color_Emoji({
  weight: "400",
  subsets: ["emoji"],
  variable: "--font-emoji",
  display: "swap",
});

// Haven tasarım dili: Space Grotesk (metin) + IBM Plex Mono (etiket/veri).
// latin-ext Türkçe karakterler (ğışçöü) için gerekli.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-space",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-plex",
  display: "swap",
});

// Uygulama adı ortam değişkeninden gelir: VPS'te "Nova", yerelde "Nova Desk".
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Nova";

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — kişisel geliştirici asistanı`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060a14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${notoEmoji.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}
    >
      <body>
        <div className="aurora" />
        {children}
      </body>
    </html>
  );
}
