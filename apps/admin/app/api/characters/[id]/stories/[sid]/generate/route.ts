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
  "당신은 AI 캐릭터 채팅 서비스의 인터랙티브 스토리(비주얼 노벨) 작가다. 주어진 세계관/캐릭터 설정에 어긋나지 않게, 요청받은 스토리 장면 본문만 한국어로 출력하라. 제목, 메타 설명, 마크다운, 선택지 나열 없이 장면 본문만 출력한다.";

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
      `# 앞선 장면들 (이 흐름에 자연스럽게 이어서 쓸 것)\n${ctx.stories
        .map((s, i) => `${i + 1}. [${s.title || "장면"}] ${s.text}`)
        .join("\n")}`
    );
  }
  if (ctx.choiceText) parts.push(`# 직전 선택\n유저가 방금 "${ctx.choiceText}" 를 선택했다. 그 선택의 결과로 이어지는 장면이다.`);
  if (node.title.trim()) parts.push(`# 이번 장면 제목\n${node.title.trim()}`);
  if (node.text.trim()) parts.push(`# 기존 초안 (참고해서 더 좋게 다시 쓸 것)\n${node.text.trim().slice(0, 1500)}`);
  const task =
    ctx.stories.length > 0 || ctx.choiceText
      ? "위 흐름에 자연스럽게 이어지는 이번 스토리 장면을 3~7문장 한국어로 써라. 3인칭 지문 서술 중심으로, 캐릭터 대사는 필요할 때만 섞는다."
      : "이 캐릭터와 유저의 인터랙티브 스토리가 시작되는 도입 장면을 3~7문장 한국어로 써라. 3인칭 지문 서술 중심으로, 캐릭터 대사는 필요할 때만 섞는다.";
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
