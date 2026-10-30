/** AI 이미지 생성 모달 [이미지 설명] 초기값 — 설명 + 상황/감정 키워드 (web/admin 동일) */
export function buildImageDescription(description: string, keywords?: string): string {
  const desc = description.trim() || "캐릭터 일러스트";
  const kw = keywords?.trim() ? `\n표현할 상황/감정 키워드: ${keywords.trim()}` : "";
  return desc + kw;
}

/** AI 이미지 생성 모달 [캐릭터 프로필] 초기값 (web/admin 동일) */
export function buildProfileText(c: { name: string; profile: string; personality: string }): string {
  return `이름: ${c.name}\n외모/설정: ${c.profile}\n성격: ${c.personality}`;
}
