import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VChatBot",
  description: "세계관 속 캐릭터와 대화하세요",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
