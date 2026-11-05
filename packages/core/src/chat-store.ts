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

/**
 * 유저가 이 캐릭터에게 실제로 보낸 최근 대사 샘플 (말투 고정용 — 스토리 장면 생성 프롬프트에 쓴다).
 * 너무 길거나 중복된 메시지는 제외하고 최신순으로 count 개.
 */
export async function sampleUserMessages(userId: number, characterId: number, count: number): Promise<string[]> {
  const col = await chatMessages();
  const docs = await col
    .find({ userId, characterId, role: "user" })
    .sort({ createdAt: -1 })
    .limit(60)
    .toArray();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const text = String(d.content ?? "").trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 120) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= count) break;
  }
  return out;
}

export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const col = await chatMessages();
  await col.insertMany(messages);
}
