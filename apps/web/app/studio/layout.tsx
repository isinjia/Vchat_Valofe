import SiteHeader from "../components/SiteHeader";

/** 스튜디오 전체(메인/세계관·캐릭터 편집 포함)에 공통 헤더(코인 잔액 등) 유지 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
