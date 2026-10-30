import { redirect } from "next/navigation";
import { loadChatContext, loadRecentMessages, isCharacterHidden, query } from "@vchatbot/core";
import { getUserId } from "@/lib/user";
import ChatClient from "./chat-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  // 미로그인 접근은 서버에서 바로 로그인 화면으로 (클라이언트 체크는 화면이 먼저 노출됨)
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { characterId } = await params;
  const { k } = await searchParams;
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) {
    return (
      <div className="container">
        <p className="empty">캐릭터를 찾을 수 없습니다.</p>
      </div>
    );
  }

  // 비공개 캐릭터: 소유자가 아니면 공유 키(?k=)가 일치해야 입장 (순번 URL 추측 방지)
  if (
    ctx.character.visibility === "private" &&
    ctx.character.owner_user_id !== userId &&
    (!ctx.character.share_key || k !== ctx.character.share_key)
  ) {
    return (
      <div className="container">
        <p className="empty">비공개 캐릭터입니다. 제작자에게 공유 링크를 받아 접속해 주세요.</p>
      </div>
    );
  }

  // 제재(기간제 비공개)/삭제 대기 캐릭터: 링크 직접 접근도 차단 — 단, 이미 대화하던 유저는 계속 허용
  if (ctx.character.delete_scheduled_at || ctx.world.delete_scheduled_at || (await isCharacterHidden(ctx.character.id))) {
    const existing = await loadRecentMessages(userId, ctx.character.id, 1);
    if (existing.length === 0) {
      return (
        <div className="container">
          <p className="empty">운영 정책에 따라 지금은 대화를 시작할 수 없는 캐릭터입니다.</p>
        </div>
      );
    }
  }

  const lc = await query<{ like_count: number }>("SELECT like_count FROM characters WHERE id = ?", [ctx.character.id]);
  const likeCount = Number(lc[0]?.like_count ?? 0);

  // 프로필 이미지 (기본 + 감정별) — 채팅 말풍선 앞 원형 표시용
  const profiles = await query<{ emotion: string; url: string }>(
    "SELECT emotion, url FROM character_profiles WHERE character_id = ?",
    [ctx.character.id]
  );
  const profileMap = Object.fromEntries(profiles.map((p) => [p.emotion, p.url]));

  const basic = ctx.illustrations.find((i) => i.kind === "basic");
  const illustMap = Object.fromEntries(ctx.illustrations.map((i) => [i.id, i.url]));

  return (
    <ChatClient
      characterId={ctx.character.id}
      characterName={ctx.character.name}
      worldName={ctx.world.name}
      avatarUrl={basic?.url ?? null}
      illustMap={illustMap}
      likeCount={likeCount}
      profileMap={profileMap}
    />
  );
}
