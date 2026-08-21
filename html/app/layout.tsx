import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  title: "弈思 · 象棋思考教练",
  description: "本地皮卡鱼驱动的中国象棋分析教练。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "弈思象棋", statusBarStyle: "black-translucent" },
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#101512" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}<PWARegister /></body></html>;
}
