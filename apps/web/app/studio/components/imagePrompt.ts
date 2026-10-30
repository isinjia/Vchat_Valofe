/** AI 이미지 생성 모달 자동 채움 프롬프트: [이미지 설명] / [캐릭터 프로필] 2섹션 (web/admin 동일) */
export function buildImagePrompt(
  c: { name: string; profile: string; personality: string },
  description: string,
  keywords?: string
): string {
  const desc = description.trim() || "캐릭터 일러스트";
  const kw = keywords?.trim() ? `\n표현할 상황/감정 키워드: ${keywords.trim()}` : "";
  return `[이미지 설명]\n${desc}${kw}\n\n[캐릭터 프로필]\n이름: ${c.name}\n외모/설정: ${c.profile}\n성격: ${c.personality}`;
}
