import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "弈思 · 象棋思考教练", description: "本地皮卡鱼驱动的中国象棋分析教练。", icons: { icon: "/favicon.svg" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
