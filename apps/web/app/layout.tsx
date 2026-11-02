import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VChatBot",
  description: "세계관 속 캐릭터와 대화하세요",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 저장된 낮/밤 스킨을 첫 페인트 전에 적용 (깜빡임 방지) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem("vc-theme");if(t==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
