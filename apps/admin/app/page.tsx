import Link from "next/link";

export default function Home() {
  return (
    <>
      <h2>대시보드</h2>
      <div className="panel">
        <p>왼쪽 메뉴에서 관리 항목을 선택하세요.</p>
        <ul style={{ marginTop: 12, paddingLeft: 20, lineHeight: 2 }}>
          <li>
            <Link href="/worlds">세계관 관리</Link> — 세계관 기본 설정, AI 프롬프트,
            지역/인명/용어 사전
          </li>
          <li>
            <Link href="/characters">캐릭터 관리</Link> — 페르소나, 관계, 말투, 프롬프트,
            일러스트 등록
          </li>
          <li>
            <Link href="/settings">설정</Link> — 일러스트 업로드 대상(S3/FTP), LLM 모델 설정
          </li>
        </ul>
      </div>
    </>
  );
}
