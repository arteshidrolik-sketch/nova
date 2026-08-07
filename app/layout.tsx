import type { Metadata, Viewport } from "next";
import { Noto_Color_Emoji } from "next/font/google";
import "./globals.css";

// Emoji fontu — VPS'te sistem emoji fontu olmadığı için başlık/buton
// emoji'leri kırık kutu (□) çıkıyordu. Bu web font ile her yerde düzgün render olur.
const notoEmoji = Noto_Color_Emoji({
  weight: "400",
  subsets: ["emoji"],
  variable: "--font-emoji",
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
  themeColor: "#02040a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className={notoEmoji.variable}>
      <body>
        <div className="aurora" />
        {children}
      </body>
    </html>
  );
}
