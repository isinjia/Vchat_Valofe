import { chatMessages } from "./mongo";
import type { ChatMessage } from "./types";

/** 특정 유저-캐릭터의 최근 대화를 시간순으로 반환 */
export async function loadRecentMessages(
  userId: number,
  characterId: number,
  limit: number
): Promise<ChatMessage[]> {
  const col = await chatMessages();
  const docs = await col
    .find({ userId, characterId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.reverse();
}

export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const col = await chatMessages();
  await col.insertMany(messages);
}
