import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  query,
  getLlmSettings,
  resolveProviderById,
  createAdapter,
  recordLlmUsage,
  normalizeStoryBoard,
  collectStoryGenContext,
  type World,
} from "@vchatbot/core";
import { storyOf } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

const SYSTEM_PROMPT =
  "당신은 AI 캐릭터 채팅 서비스의 인터랙티브 스토리 설계자다. 지금 작성하는 것은 스토리 카드의 '배경설정'이다 — 플레이 시 AI 가 이 배경설정을 바탕으로 캐릭터와 플레이어의 대화 장면을 생성한다. 주어진 세계관/캐릭터 설정에 어긋나지 않게, 요청받은 배경설정 본문만 한국어로 출력하라. 제목, 메타 설명, 마크다운, 대사, 선택지 나열 없이 설정 서술만 출력한다.";

/** POST { nodeId, board } — 스토리 카드 텍스트 AI 생성 (어드민: 과금 없음) */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
  if ("res" in g) return g.res;

  const body = await req.json().catch(() => ({}));
  const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
  const board = normalizeStoryBoard(body.board);
  const node = board.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "story") return bad("nodeId 가 스토리 카드가 아닙니다.");

  const chars = await query<Record<string, string | number | null>>("SELECT * FROM characters WHERE id = ?", [Number(id)]);
  const c = chars[0];
  if (!c) return bad("캐릭터를 찾을 수 없습니다.", 404);
  const ws = await query<World>("SELECT * FROM worlds WHERE id = ?", [Number(c.world_id)]);
  const world = ws[0];
  const ctx = collectStoryGenContext(board, nodeId);

  const parts: string[] = [];
  if (world) parts.push(`# 세계관: ${world.name}\n${world.description}`);
  parts.push(
    `# 캐릭터: ${c.name}\n${String(c.profile ?? "")}\n\n성격: ${String(c.personality ?? "")}\n말투: ${String(c.speech_style ?? "")}`
  );
  parts.push(`# 스토리 제목: ${g.story.title}`);
  if (ctx.stories.length > 0) {
    parts.push(
      `# 앞에 연결된 장면들의 배경설정 (이 흐름에서 자연스럽게 이어질 것)\n${ctx.stories
        .map((s, i) => `${i + 1}. [${s.title || "장면"}] ${s.text}`)
        .join("\n")}`
    );
  }
  if (ctx.choiceText) parts.push(`# 직전 선택\n플레이어가 방금 "${ctx.choiceText}" 를 선택했다. 그 선택의 결과로 이어지는 장면이다.`);
  if (ctx.nextStories.length > 0) {
    parts.push(
      `# 뒤에 연결된 장면들의 배경설정 (이 장면이 자연스럽게 여기로 이어지도록 복선/연결을 고려할 것)\n${ctx.nextStories
        .map((s, i) => `${i + 1}. [${s.title || "장면"}] ${s.text}`)
        .join("\n")}`
    );
  }
  if (ctx.nextChoices.length > 0) {
    parts.push(`# 이 장면 끝에서 플레이어가 고르게 될 선택지\n${ctx.nextChoices.map((c) => `- ${c}`).join("\n")}`);
  }
  if (node.title.trim()) parts.push(`# 이번 장면 제목\n${node.title.trim()}`);
  if (node.text.trim()) parts.push(`# 기존 배경설정 초안 (참고해서 더 좋게 다시 쓸 것)\n${node.text.trim().slice(0, 1500)}`);
  const task =
    ctx.stories.length > 0 || ctx.choiceText
      ? "이번 스토리 카드의 배경설정을 3~6문장 한국어로 써라. 장소·시간대·분위기, 캐릭터의 상태, 이 장면에서 벌어질 상황을 설정 서술로 쓰되, 앞 흐름을 받아 뒤 장면/선택지로 자연스럽게 이어지게 하라. 대사는 쓰지 마라."
      : "이 캐릭터와 플레이어의 인터랙티브 스토리가 시작되는 도입 장면의 배경설정을 3~6문장 한국어로 써라. 장소·시간대·분위기, 캐릭터의 상태, 벌어질 상황을 설정 서술로 쓰되, 뒤 장면/선택지로 자연스럽게 이어지게 하라. 대사는 쓰지 마라.";
  const userContent = `${parts.join("\n\n")}\n\n---\n${task}`;

  let text: string;
  try {
    const llm = await getLlmSettings();
    const assist = llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
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
      const response = await new Anthropic().messages.create({
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
  } catch (err) {
    console.error("admin story generate error:", err);
    const msg = err instanceof Anthropic.APIError ? `AI 호출 오류 (${err.status}): ${err.message}` : "AI 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!text) return NextResponse.json({ error: "생성 결과가 비어 있습니다." }, { status: 502 });
  return NextResponse.json({ text });
}
