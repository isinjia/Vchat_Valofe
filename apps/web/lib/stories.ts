import { NextResponse } from "next/server";
import { getCharacterStory, type CharacterStoryRow } from "@vchatbot/core";
import { ownedCharacter, bad } from "@/lib/studio";

/** 스토리 소유권 가드: 내 캐릭터 + 그 캐릭터의 스토리인지 */
export async function ownedStory(
  characterId: string | number,
  storyId: string | number,
  userId: number
): Promise<{ story: CharacterStoryRow; characterRow: Record<string, unknown> } | { res: NextResponse }> {
  const own = await ownedCharacter(characterId, userId);
  if ("res" in own) return own;
  const sid = Number(storyId);
  if (!Number.isInteger(sid) || sid <= 0) return { res: bad("스토리 id 가 올바르지 않습니다.") };
  const story = await getCharacterStory(sid);
  if (!story || Number(story.character_id) !== Number(characterId)) {
    return { res: bad("스토리를 찾을 수 없습니다.", 404) };
  }
  return { story, characterRow: own.row };
}
