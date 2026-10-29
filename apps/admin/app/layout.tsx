import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "VChatBot 관리자",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="layout">
          <nav className="sidebar">
            <h1>VChatBot 관리자</h1>
            <Link href="/worlds">세계관 관리</Link>
            <Link href="/characters">캐릭터 관리</Link>
            <Link href="/presets">기념일 프리셋</Link>
            <Link href="/llm">LLM 관리</Link>
            <Link href="/tiers">채팅 등급</Link>
            <Link href="/stats">사용량 통계</Link>
            <Link href="/settings">설정 (스토리지/LLM)</Link>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
