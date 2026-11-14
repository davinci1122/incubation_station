import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// フォントはビルド時に外部から取得せず、パッケージに含まれるものを使う（CIの失敗を防ぐ）。
import "@fontsource/figtree/300.css";
import "@fontsource/figtree/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "INTERNET CABINET", template: "%s — INTERNET CABINET" },
  description: "A personal archive of the web.",
  manifest: `${basePath}/manifest.webmanifest`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fbf0ec",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
