import type { Metadata } from "next";
import "./globals.css";
import NovaPlayground from "@/components/NovaPlayground";

export const metadata: Metadata = {
  title: "Nova",
  description: "Nova — kişisel geliştirici asistanı",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>
        <div className="aurora" />
        <NovaPlayground />
        {children}
      </body>
    </html>
  );
}
