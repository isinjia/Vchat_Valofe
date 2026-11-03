import { NextResponse } from "next/server";
import { getCharacterStory, type CharacterStoryRow } from "@vchatbot/core";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** 어드민용 스토리 가드: 해당 캐릭터의 스토리인지만 확인 (권한은 미들웨어) */
export async function storyOf(
  characterId: string | number,
  storyId: string | number
): Promise<{ story: CharacterStoryRow } | { res: NextResponse }> {
  const sid = Number(storyId);
  if (!Number.isInteger(sid) || sid <= 0) return { res: bad("스토리 id 가 올바르지 않습니다.") };
  const story = await getCharacterStory(sid);
  if (!story || Number(story.character_id) !== Number(characterId)) {
    return { res: bad("스토리를 찾을 수 없습니다.", 404) };
  }
  return { story };
}
