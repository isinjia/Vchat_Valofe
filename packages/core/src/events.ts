import { query, execute } from "./mysql";
import { getScoringSettings } from "./settings";
import { resolveProviderById, createAdapter } from "./llm/routing";
import { recordLlmUsage } from "./llm/accounts";
import type { UserRelationship } from "./relationship";

/** 이벤트 정의 (캐릭터 설정의 '이벤트 채팅' 탭에서 등록) */
export interface CharacterEventRow {
  id: number;
  character_id: number;
  name: string;
  trigger_affinity_min: number | null;
  trigger_keywords: string | null;
  trigger_relationship: UserRelationship | null;
  situation: string;
  success_condition: string;
  fail_condition: string | null;
  set_relationship: Exclude<UserRelationship, "none"> | null;
  retry_hours: number;
  max_turns: number;
  is_active: number;
  created_at: string;
}

export interface ActiveEventState {
  /** user_character_events.id */
  uceId: number;
  turns: number;
  event: CharacterEventRow;
  /** 이번 턴에 새로 발동했는지 */
  justStarted: boolean;
}

/** 진행 중(active) 이벤트 조회 */
export async function getActiveEvent(userId: number, characterId: number): Promise<ActiveEventState | null> {
  const rows = await query<{ uce_id: number; turns: number } & CharacterEventRow>(
    `SELECT e.*, u.id AS uce_id, u.turns
     FROM user_character_events u JOIN character_events e ON e.id = u.event_id
     WHERE u.user_id = ? AND u.character_id = ? AND u.status = 'active'
     ORDER BY u.id DESC LIMIT 1`,
    [userId, characterId]
  );
  if (rows.length === 0) return null;
  const { uce_id, turns, ...event } = rows[0];
  return { uceId: uce_id, turns, event: event as CharacterEventRow, justStarted: false };
}

/**
 * 발동 조건 검사 후 이벤트 시작. 조건:
 * - is_active, 아직 성공한 적 없음, 마지막 실패 후 retry_hours 경과
 * - trigger_affinity_min / trigger_relationship / trigger_keywords (지정된 것만, AND)
 */
export async function maybeStartEvent(
  userId: number,
  characterId: number,
  state: { affinity: number; relationship: UserRelationship },
  userMessage: string
): Promise<ActiveEventState | null> {
  const candidates = await query<CharacterEventRow>(
    `SELECT e.* FROM character_events e
     WHERE e.character_id = ? AND e.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM user_character_events s
             WHERE s.event_id = e.id AND s.user_id = ? AND s.status = 'success')
       AND NOT EXISTS (SELECT 1 FROM user_character_events f
             WHERE f.event_id = e.id AND f.user_id = ? AND f.status = 'failed'
               AND f.ended_at > DATE_SUB(NOW(), INTERVAL e.retry_hours HOUR))
     ORDER BY e.id`,
    [characterId, userId, userId]
  );
  for (const e of candidates) {
    if (e.trigger_affinity_min != null && state.affinity < e.trigger_affinity_min) continue;
    if (e.trigger_relationship != null && state.relationship !== e.trigger_relationship) continue;
    if (e.trigger_keywords) {
      const keywords = e.trigger_keywords.split(",").map((k) => k.trim()).filter(Boolean);
      if (keywords.length > 0 && !keywords.some((k) => userMessage.includes(k))) continue;
    }
    const result = await execute(
      "INSERT INTO user_character_events (user_id, character_id, event_id) VALUES (?, ?, ?)",
      [userId, characterId, e.id]
    );
    return { uceId: result.insertId, turns: 0, event: e, justStarted: true };
  }
  return null;
}

/** 이벤트 턴 증가 후 현재 턴 수 반환 */
export async function recordEventTurn(uceId: number): Promise<number> {
  await execute("UPDATE user_character_events SET turns = turns + 1 WHERE id = ?", [uceId]);
  const rows = await query<{ turns: number }>("SELECT turns FROM user_character_events WHERE id = ?", [uceId]);
  return Number(rows[0]?.turns ?? 0);
}

export async function finishEvent(uceId: number, status: "success" | "failed"): Promise<void> {
  await execute("UPDATE user_character_events SET status = ?, ended_at = NOW() WHERE id = ?", [status, uceId]);
}

/** 달성(성공)한 이벤트 id 목록 — 일러스트 노출 조건용 */
export async function getAchievedEventIds(userId: number, characterId: number): Promise<Set<number>> {
  const rows = await query<{ event_id: number }>(
    "SELECT DISTINCT event_id FROM user_character_events WHERE user_id = ? AND character_id = ? AND status = 'success'",
    [userId, characterId]
  );
  return new Set(rows.map((r) => Number(r.event_id)));
}

export type EventJudgeResult = "success" | "fail" | "ongoing";

/** 이벤트 상황 지시 블록 (user 메시지 앞에 붙인다) */
export function formatEventBlock(e: CharacterEventRow, justStarted: boolean): string {
  return [
    `[이벤트 진행 중: ${e.name}]`,
    justStarted ? `지금 이 상황이 시작된다: ${e.situation}` : `진행 중인 상황: ${e.situation}`,
    "이 상황을 이번 응답에 자연스럽게 전개하라. 성공/실패/판정 같은 시스템 개념은 입에 올리지 마라.",
  ].join("\n");
}

/**
 * 채점용 LLM 으로 이벤트 성공/실패 판정. 판정 불가(LLM 미설정/오류)면 'ongoing'.
 * 실패 조건이 없으면 명시적 fail 판정은 내리지 않는다 (턴 초과 실패는 호출부가 처리).
 */
export async function judgeEvent(input: {
  event: CharacterEventRow;
  recentDialogue: string;
}): Promise<EventJudgeResult> {
  try {
    const scoring = await getScoringSettings();
    if (!scoring.scoringProviderId) return "ongoing";
    const resolved = await resolveProviderById(Number(scoring.scoringProviderId));
    if (!resolved) return "ongoing";
    const adapter = await createAdapter(resolved.provider, resolved.account);
    const e = input.event;
    const system = `너는 롤플레이 이벤트의 판정관이다. 대화를 보고 이벤트의 결과를 판정하라.
반드시 JSON 객체 하나로만 응답하라. 설명·코드펜스 금지: {"result": "success" 또는 "fail" 또는 "ongoing", "reason": "한 문장"}
- success: 성공 조건이 충족됐다.
- fail: 실패 조건이 명확히 충족됐다.${e.fail_condition ? "" : " (실패 조건이 없으므로 fail 은 거의 쓰지 마라)"}
- ongoing: 아직 어느 쪽도 확정되지 않았다. 애매하면 ongoing.`;
    const content = `[이벤트 상황]\n${e.situation}\n\n[성공 조건]\n${e.success_condition}\n\n[실패 조건]\n${e.fail_condition ?? "(명시 없음 — 최대 턴 초과 시에만 실패)"}\n\n[최근 대화]\n${input.recentDialogue}`;
    const stream = adapter.streamChat({ system, messages: [{ role: "user", content }], maxTokens: 300 });
    let text = "";
    for await (const d of stream.deltas) text += d;
    const usage = stream.outcome().usage;
    if (usage) await recordLlmUsage(resolved.provider.id, resolved.account?.id ?? null, usage);
    const stripped = text.replace(/```(?:json)?/gi, "");
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return "ongoing";
    const obj = JSON.parse(stripped.slice(start, end + 1)) as { result?: string };
    if (obj.result === "success") return "success";
    if (obj.result === "fail") return "fail";
    return "ongoing";
  } catch (err) {
    console.error("judgeEvent error:", err);
    return "ongoing";
  }
}
