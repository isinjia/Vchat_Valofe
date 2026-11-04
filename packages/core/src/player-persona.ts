/**
 * 플레이어(유저) 성격 타입 — 가입(첫 로그인) 시 선택해 users.personality_type 에 저장한다.
 * 스토리 플레이 장면 생성 시 플레이어("나") 대사의 말투를 고정하는 데 쓴다.
 */
export interface PlayerPersonalityType {
  key: string;
  label: string;
  /** 말투 특징 — 유저에게 보여주는 설명이자 AI 프롬프트에 그대로 들어가는 지시문 */
  desc: string;
}

export const PLAYER_PERSONALITY_TYPES: PlayerPersonalityType[] = [
  { key: "cheerful", label: "활발·유쾌", desc: "텐션이 높고 밝다. 감탄사와 유머를 자주 쓰고 리액션이 크다." },
  { key: "calm", label: "차분·신중", desc: "말수가 적고 차분하다. 정제된 표현으로 또박또박 말한다." },
  { key: "warm", label: "다정·공감", desc: "상냥하고 배려가 깊다. 상대의 감정을 먼저 살피며 부드럽게 말한다." },
  { key: "blunt", label: "시크·직설", desc: "짧고 건조하게 말한다. 돌려 말하지 않고 감정 표현을 아낀다." },
  { key: "playful", label: "장난기·능청", desc: "짓궂은 농담과 능청스러운 말장난을 즐긴다. 가볍게 놀리는 티키타카를 좋아한다." },
  { key: "serious", label: "진지·열혈", desc: "진지하고 열정적이다. 목표와 의리를 중시하는 직진 화법을 쓴다." },
];

export function getPlayerPersonalityType(key: string | null | undefined): PlayerPersonalityType | null {
  if (!key) return null;
  return PLAYER_PERSONALITY_TYPES.find((t) => t.key === key) ?? null;
}
