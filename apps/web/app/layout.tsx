import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, Noto_Sans_JP } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jp = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-jp",
  display: "swap",
  preload: false,
});

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "INTERNET CABINET", template: "%s — INTERNET CABINET" },
  description: "A personal archive of the web.",
  manifest: `${basePath}/manifest.webmanifest`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f5f3ed",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${serif.variable} ${sans.variable} ${jp.variable}`}>
      <body>{children}</body>
    </html>
  );
}
