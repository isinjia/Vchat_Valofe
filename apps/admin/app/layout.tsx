import type { Metadata } from "next";
import Link from "next/link";
import { getAdminUser } from "@/lib/admin-session";
import LogoutButton from "./components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "VChatBot 관리자",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 미들웨어가 비로그인 접근을 /login 으로 돌리므로, 세션이 없으면 로그인 화면(사이드바 없음)
  const admin = await getAdminUser();
  const isSystem = admin?.role === "system_admin";

  return (
    <html lang="ko">
      <body>
        {!admin ? (
          <main>{children}</main>
        ) : (
          <div className="layout">
            <nav className="sidebar">
              <h1>VChatBot 관리자</h1>
              <div style={{ padding: "0 20px 4px", fontSize: 12, color: "#768390" }}>
                {/* vfun 닉네임은 바뀔 수 있으므로 user id + no 로 표시 */}
                {admin.vfunUserId ?? admin.nickname} <span>no.{admin.uNo ?? admin.uid}</span>
                <div>{isSystem ? "시스템 관리자" : "유저 관리자"}</div>
              </div>
              <Link href="/stats">📊 대시보드</Link>
              <div className="nav-group">월드 관리</div>
              <Link href="/worlds">세계관 관리</Link>
              <Link href="/characters">캐릭터 관리</Link>
              {isSystem && <Link href="/presets">기념일 프리셋</Link>}
              <div className="nav-group">유저 관리</div>
              <Link href="/users">유저 관리</Link>
              {isSystem && <Link href="/tiers">등급</Link>}
              {isSystem && (
                <>
                  <div className="nav-group">시스템 관리</div>
                  <Link href="/llm">LLM 관리</Link>
                  <Link href="/ai-levels">채팅 AI 레벨</Link>
                  <Link href="/settings">설정</Link>
                  <Link href="/admins">관리자 관리</Link>
                  <Link href="/logs">관리자 로그</Link>
                </>
              )}
              <LogoutButton />
            </nav>
            <main className="main">{children}</main>
          </div>
        )}
      </body>
    </html>
  );
}
