import type { LlmAdapter } from "./llm/adapter";

/** 게스트로 등장할 인물 정보 (사전 항목 + 연결 캐릭터 페르소나) */
export interface GuestInfo {
  entryId: number;
  name: string;
  /** 사전 항목 content */
  content: string;
  /** 사전 항목에 연결된 캐릭터가 있을 때만 */
  persona?: { personality: string; speech_style: string; profile: string } | null;
}

/**
 * 게스트 난입 대사 생성 (비스트리밍처럼 사용).
 * 플랫폼 연출이므로 호출부에서 유저 코인을 차감하지 않는다. 실패 시 throw → 호출부에서 조용히 스킵.
 */
export async function generateGuestLine(opts: {
  adapter: LlmAdapter;
  worldName: string;
  hostName: string;
  guest: GuestInfo;
  recentDialogue: string;
  lineHint: string;
  /** 캐릭터의 상황 설정(현재 장면) */
  scenario?: string | null;
}): Promise<string> {
  const { adapter, worldName, hostName, guest, recentDialogue, lineHint, scenario } = opts;
  const summary = guest.content.slice(0, 800);
  const personaText = guest.persona
    ? ` 프로필: ${guest.persona.profile}. 성격: ${guest.persona.personality}. 말투: ${guest.persona.speech_style}.`
    : "";
  const system =
    `너는 '${worldName}' 세계관의 '${guest.name}' 이다. ${summary}${personaText}\n` +
    `지금 ${hostName} 와 유저의 대화에 잠깐 끼어들어 1~2문장만 말하고 떠난다. ` +
    `대사만 출력하라(지문/괄호 금지). 끼어드는 맥락: ${lineHint}
` +
    `현재 장면: ${scenario?.trim() || "(설정 없음)"}. 끼어드는 경로는 맥락(lineHint)을 따르고, 장면에 맞지 않는 등장(없던 공간에 갑자기 나타나기)을 하지 마라. 1~2문장 말하고 자연스럽게 빠진다.`;

  const stream = adapter.streamChat({
    system,
    messages: [{ role: "user", content: recentDialogue }],
    maxTokens: 300,
  });
  const parts: string[] = [];
  for await (const d of stream.deltas) parts.push(d);
  const text = parts.join("").trim();
  if (!text) throw new Error("게스트 대사가 비어 있습니다.");
  return text;
}
