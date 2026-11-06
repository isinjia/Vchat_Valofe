import { query } from "@vchatbot/core";
import ChatPage from "../chat/[characterId]/page";
import ConstantiaStream from "../constantia/ConstantiaStream";

export const dynamic = "force-dynamic";

/**
 * 라스트오리진 '블랙 리리스' 방송 페이지 — 하루 방송과 같은 배치: 왼쪽(좁은 화면은 위) 2D 일러스트 방송 화면,
 * 오른쪽(아래) 일반 캐릭터 채팅. 대화에 따라 방송 화면 속 블랙 리리스가 입을 움직이고 눈을 깜빡인다.
 */
export default async function BlackLilithPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const rows = await query<{ id: number }>(
    `SELECT c.id FROM characters c JOIN worlds w ON w.id = c.world_id
     WHERE c.name = '블랙 리리스' AND w.name = '라스트오리진' AND c.is_active = 1
     ORDER BY c.id LIMIT 1`
  );
  if (rows.length === 0) {
    return (
      <div className="container">
        <p className="empty">블랙 리리스 캐릭터가 아직 등록되지 않았습니다. 관리자 화면에서 라스트오리진 세계관에 &apos;블랙 리리스&apos;를 만들어 주세요.</p>
      </div>
    );
  }
  const chat = await ChatPage({ params: Promise.resolve({ characterId: String(rows[0].id) }), searchParams });
  return (
    <div className="haru-live">
      <section className="haru-live-stage" aria-label="블랙 리리스 방송 화면">
        <ConstantiaStream modelId="blacklilith" title="블랙 리리스의 경호 대기실 · 수다 방송" />
      </section>
      <div className="haru-live-chat">{chat}</div>
    </div>
  );
}
