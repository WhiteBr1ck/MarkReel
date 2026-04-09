import type { ReactNode } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "MarkReel",
  description: "开源自托管的视频审阅与标注工具"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={`${space.variable} ${mono.variable}`}>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-sans), ui-sans-serif, system-ui",
          background: "var(--bg)",
          color: "var(--text)"
        }}
      >
        {children}
      </body>
    </html>
  );
}
