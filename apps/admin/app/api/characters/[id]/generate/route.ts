import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  query,
  getLlmSettings,
  resolveProviderById,
  createAdapter,
  recordLlmUsage,
  type CharacterPersona,
  type World,
} from "@vchatbot/core";

export const runtime = "nodejs";

const client = new Anthropic();

type Params = { params: Promise<{ id: string }> };

const SYSTEM_PROMPT = `당신은 AI 캐릭터 채팅 서비스의 시나리오 작가다. 주어진 세계관과 캐릭터 설정에 어긋나지 않게, 요청받은 텍스트만 한국어로 출력하라. 제목, 따옴표 설명, 메타 설명, 마크다운 없이 본문만 출력한다.`;

/**
 * POST /api/characters/:id/generate  { field: "scenario" | "greeting", scenario?: string }
 * 상황 설정/첫 인사말 초안을 AI 로 생성해 {text} 로 반환한다. (운영자 도구 — 코인 과금 없음, DB 저장 안 함)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const field = body.field;
  if (field !== "scenario" && field !== "greeting") {
    return Response.json({ error: "field 는 scenario 또는 greeting 이어야 합니다." }, { status: 400 });
  }

  const chars = await query<CharacterPersona>("SELECT * FROM characters WHERE id = ?", [id]);
  if (chars.length === 0) return Response.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  const character = chars[0];
  const worlds = await query<World>("SELECT * FROM worlds WHERE id = ?", [character.world_id]);
  const world = worlds[0];
  const places = await query<{ title: string; content: string }>(
    "SELECT title, content FROM world_dictionary WHERE world_id = ? AND category = 'location' ORDER BY sort_order, id LIMIT 5",
    [character.world_id]
  );

  // 화면에서 편집 중(미저장)인 상황 설정이 있으면 우선 사용
  const scenario = (typeof body.scenario === "string" ? body.scenario : character.scenario ?? "").trim();

  const context = [
    world ? `# 세계관: ${world.name}\n${world.description}` : "",
    places.length > 0
      ? `# 주요 지역\n${places.map((p) => `- ${p.title}: ${p.content}`).join("\n")}`
      : "",
    `# 캐릭터: ${character.name}\n${character.profile}`,
    `# 성격\n${character.personality}`,
    `# 말투\n${character.speech_style}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let task: string;
  if (field === "scenario") {
    task = "이 캐릭터와 유저의 1:1 대화가 시작되기 좋은 구체적 상황 1개를 3~5문장 한국어로 써라.";
  } else {
    task =
      (scenario ? `# 대화 시작 상황\n${scenario}\n\n` : "") +
      "캐릭터가 대화 시작 시 유저에게 먼저 건네는 첫 대사를 캐릭터 말투로 2~4문장으로 써라.";
  }

  try {
    const llm = await getLlmSettings();
    const userContent = `${context}\n\n---\n${task}`;
    const assist = llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
    let text: string;
    if (assist) {
      const adapter = await createAdapter(assist.provider, assist.account);
      const stream = adapter.streamChat({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        maxTokens: 1024,
      });
      let acc = "";
      for await (const d of stream.deltas) acc += d;
      text = acc.trim();
      const usage = stream.outcome().usage;
      if (usage) await recordLlmUsage(assist.provider.id, assist.account?.id ?? null, usage);
    } else {
      const response = await client.messages.create({
        model: llm.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    }
    if (!text) return Response.json({ error: "생성 결과가 비어 있습니다." }, { status: 502 });
    return Response.json({ text });
  } catch (err) {
    console.error("character generate error:", err);
    const msg =
      err instanceof Anthropic.APIError
        ? `AI 호출 오류 (${err.status}): ${err.message}`
        : "AI 생성 중 오류가 발생했습니다.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
