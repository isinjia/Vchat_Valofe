import { loadChatContext } from "@vchatbot/core";
import ChatClient from "./chat-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const ctx = await loadChatContext(Number(characterId));
  if (!ctx) {
    return (
      <div className="container">
        <p className="empty">캐릭터를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const basic = ctx.illustrations.find((i) => i.kind === "basic");
  const illustMap = Object.fromEntries(ctx.illustrations.map((i) => [i.id, i.url]));

  return (
    <ChatClient
      characterId={ctx.character.id}
      characterName={ctx.character.name}
      worldId={ctx.world.id}
      worldName={ctx.world.name}
      avatarUrl={basic?.url ?? null}
      illustMap={illustMap}
    />
  );
}
