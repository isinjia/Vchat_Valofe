import { query } from "@vchatbot/core";
import ChatPage from "../chat/[characterId]/page";
import HaruStream from "./HaruStream";

export const dynamic = "force-dynamic";

/**
 * 소울워커 '하루 에스티아' 전용 채팅 페이지 — 방송 플랫폼처럼 왼쪽(좁은 화면은 위)에 하루의 방송 화면,
 * 오른쪽(아래)에 일반 캐릭터 채팅 화면을 그대로 둔다. 대화에 따라 방송 화면 속 하루가 말하고 움직인다.
 */
export default async function HaruPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const rows = await query<{ id: number }>(
    `SELECT c.id FROM characters c JOIN worlds w ON w.id = c.world_id
     WHERE c.name = '하루 에스티아' AND w.name = '소울워커' AND c.is_active = 1
     ORDER BY c.id LIMIT 1`
  );
  if (rows.length === 0) {
    return (
      <div className="container">
        <p className="empty">하루 캐릭터가 아직 등록되지 않았습니다. 관리자 화면에서 소울워커 세계관에 &apos;하루 에스티아&apos;를 만들어 주세요.</p>
      </div>
    );
  }
  const chat = await ChatPage({ params: Promise.resolve({ characterId: String(rows[0].id) }), searchParams });
  return (
    <div className="haru-live">
      <section className="haru-live-stage" aria-label="하루 방송 화면">
        <HaruStream />
      </section>
      <div className="haru-live-chat">{chat}</div>
    </div>
  );
}
