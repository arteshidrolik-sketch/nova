import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova — Geliştirici Asistanı",
  description: "Çok-ajanlı kişisel geliştirici asistanı",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        <div className="aurora" aria-hidden />
        {children}
      </body>
    </html>
  );
}
