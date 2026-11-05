import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  query,
  isCharacterHidden,
  getCharacterStory,
  normalizeStoryBoard,
  getStoryRun,
  runRowToState,
  viewOfState,
  startStoryRun,
  continueStoryRun,
  chooseStoryOption,
  saveStoryRun,
  collectStoryGenContext,
  parseSceneLines,
  getStorySceneCache,
  saveStorySceneCache,
  getStorySceneCacheMap,
  clearStorySceneCache,
  sampleUserMessages,
  getPlayerPersonalityType,
  getLlmSettings,
  resolveProviderById,
  createAdapter,
  recordLlmUsage,
  getPricingSettings,
  resolveAiAssistPricing,
  calcAiAssistCost,
  chargeCoins,
  buildRatingBlock,
  type StoryBoard,
  type StoryCardNode,
  type SceneLine,
  type CharacterStoryRow,
  type World,
} from "@vchatbot/core";
import { getUserId, isAdultUser, ADULT_BLOCK_MESSAGE } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Params = { params: Promise<{ sid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

interface CharRow {
  id: number;
  name: string;
  profile: string;
  personality: string;
  speech_style: string;
  world_id: number;
  is_adult: number;
  owner_user_id: number | null;
  visibility: string;
  share_key: string | null;
  delete_scheduled_at: string | null;
}

/**
 * 스토리 플레이 가드: 로그인 + 공개된 스토리 + 캐릭터 접근 가능(비공개면 소유자 또는 공유 키).
 * 변수값은 절대 응답에 넣지 않는다 (내부 수치 비노출 정책).
 */
async function guard(
  sidRaw: string,
  k: string | null,
  userId: number
): Promise<{ story: CharacterStoryRow; board: StoryBoard; char: CharRow } | { res: NextResponse }> {
  const sid = Number(sidRaw);
  if (!Number.isInteger(sid) || sid <= 0) return { res: bad("스토리 id 가 올바르지 않습니다.") };
  const story = await getCharacterStory(sid);
  if (!story || story.status !== "published" || !story.published_json) {
    return { res: bad("플레이할 수 없는 스토리입니다.", 404) };
  }
  const chars = await query<CharRow>(
    "SELECT id, name, profile, personality, speech_style, world_id, is_adult, owner_user_id, visibility, share_key, delete_scheduled_at FROM characters WHERE id = ?",
    [story.character_id]
  );
  const c = chars[0];
  if (!c) return { res: bad("캐릭터를 찾을 수 없습니다.", 404) };
  if (c.visibility === "private" && c.owner_user_id !== userId && (!c.share_key || k !== c.share_key)) {
    return { res: bad("비공개 캐릭터입니다.", 403) };
  }
  if (c.delete_scheduled_at || (await isCharacterHidden(c.id))) {
    return { res: bad("지금은 플레이할 수 없는 캐릭터입니다.", 403) };
  }
  // 19금 스토리(자체 설정 또는 캐릭터/세계관 상속) — 성인 확인된 유저만
  const wa = await query<{ is_adult: number }>("SELECT is_adult FROM worlds WHERE id = ?", [Number(c.world_id)]);
  const adultStory =
    Number(story.is_adult) === 1 || Number(c.is_adult) === 1 || Number(wa[0]?.is_adult ?? 0) === 1;
  if (adultStory && !(await isAdultUser(userId))) {
    return { res: bad(ADULT_BLOCK_MESSAGE, 403) };
  }
  return { story, board: normalizeStoryBoard(JSON.parse(story.published_json)), char: c };
}

// 현재 진행 상태 조회
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  if (userId == null) return bad("로그인이 필요합니다.", 401);
  const { sid } = await params;
  const g = await guard(sid, req.nextUrl.searchParams.get("k"), userId);
  if ("res" in g) return g.res;

  const run = await getStoryRun(userId, g.story.id);
  if (!run)
    return NextResponse.json({
      title: g.story.title,
      titleImageUrl: g.story.title_image_url,
      characterName: g.char.name,
      status: "idle",
      view: null,
    });
  const state = runRowToState(run);
  // 플레이 로그 복원: 지나온 장면(캐시된 대본 포함)과 고른 선택지를 전부 내려 재접속 시 그대로 보여준다
  const sceneMap = await getStorySceneCacheMap(userId, g.story.id);
  const nodeById = new Map(g.board.nodes.map((n) => [n.id, n]));
  type PlayLogItem =
    | { kind: "pick"; text: string }
    | { kind: "story"; nodeId: string; title: string | null; imageUrl: string | null; text: string | null; lines: SceneLine[] | null };
  const log = state.log.flatMap((e): PlayLogItem[] => {
    if (e.t === "pick") return [{ kind: "pick", text: e.text }];
    const node = nodeById.get(e.nodeId);
    if (!node || node.type !== "story") return []; // 보드 재공개로 사라진 노드는 건너뜀
    const cached = sceneMap[e.nodeId];
    return [
      {
        kind: "story",
        nodeId: node.id,
        title: node.title,
        imageUrl: node.imageUrl ?? null,
        text: node.text,
        lines: cached ? parseSceneLines(cached, g.char.name) : null,
      },
    ];
  });
  return NextResponse.json({
    title: g.story.title,
    titleImageUrl: g.story.title_image_url,
    characterName: g.char.name,
    status: state.finished ? "finished" : "active",
    view: viewOfState(g.board, state),
    log,
  });
}

/** 장면 설정 → AI 가 캐릭터+플레이어의 대화 장면(대본)을 생성. usage 는 과금용 */
async function generateSceneScript(
  story: CharacterStoryRow,
  board: StoryBoard,
  node: StoryCardNode,
  char: CharRow,
  userId: number
): Promise<{ text: string; usage: { inputTokens?: number; outputTokens?: number } | null }> {
  const ws = await query<World>("SELECT * FROM worlds WHERE id = ?", [Number(char.world_id)]);
  const world = ws[0];
  const ctx = collectStoryGenContext(board, node.id);
  // 유효 19금: 스토리 플래그 ∨ 캐릭터 ∨ 세계관
  const adult = Number(story.is_adult) === 1 || Number(char.is_adult) === 1 || Number(world?.is_adult ?? 0) === 1;

  // 플레이어("나") 말투 고정: 가입 시 고른 성격 타입 + 이 캐릭터에게 실제로 보낸 대사 샘플
  const [personaRows, speechSamples] = await Promise.all([
    query<{ personality_type: string | null }>("SELECT personality_type FROM users WHERE id = ?", [userId]),
    sampleUserMessages(userId, char.id, 5),
  ]);
  const personaType = getPlayerPersonalityType(personaRows[0]?.personality_type);

  const system = `당신은 AI 캐릭터 채팅 서비스의 인터랙티브 스토리 연출가다. 주어진 세계관/캐릭터/장면 설정을 바탕으로, 캐릭터 "${char.name}" 와 플레이어(유저)가 주고받는 대화 장면을 소설처럼 쓴다. 플레이어의 대사도 당신이 쓴다.

${buildRatingBlock(adult)}
출력 형식 — 반드시 이 형식의 줄들로만 출력한다:
(상황이나 행동 묘사 — 소괄호로 감싼 지문, 자기 줄에 단독으로)
${char.name}: 캐릭터의 대사
나: 플레이어의 대사 (1인칭)
규칙:
- 총 6~14줄, 대사 위주로. 제목·마크다운·메타 설명·빈 괄호 금지.
- 캐릭터는 설정된 성격과 말투를 유지한다.
- 플레이어("나")의 대사는 "# 플레이어(나) 설정"의 성격 타입과 말투 샘플을 따라, 매 장면 일관된 어투로 쓴다.
- 장면 설정의 사건을 자연스럽게 전개하되, 이 장면 안에서 이야기를 끝내지 말고 다음 전개를 암시하며 멈춘다.
- 선택지를 제시하거나 "선택하세요" 같은 시스템 문구를 쓰지 않는다.`;

  const parts: string[] = [];
  if (world) parts.push(`# 세계관: ${world.name}\n${world.description}`);
  parts.push(
    `# 캐릭터: ${char.name}\n${char.profile}\n\n성격: ${char.personality}\n말투: ${char.speech_style}`
  );
  // 플레이어 말투 고정 블록 (성격 타입이나 대사 샘플이 있을 때만)
  if (personaType || speechSamples.length > 0) {
    const pl: string[] = ["# 플레이어(나) 설정"];
    if (personaType) pl.push(`성격 타입: ${personaType.label} — ${personaType.desc}`);
    if (speechSamples.length > 0) {
      pl.push(`${char.name} 에게 실제로 보낸 메시지 (말투 참고용 — 내용은 따라하지 말 것):`);
      for (const s of speechSamples) pl.push(`- "${s}"`);
    }
    parts.push(pl.join("\n"));
  }
  parts.push(`# 스토리 제목: ${story.title}`);
  if (ctx.stories.length > 0) {
    parts.push(
      `# 앞선 장면들의 설정 (흐름 참고)\n${ctx.stories.map((s, i) => `${i + 1}. [${s.title || "장면"}] ${s.text}`).join("\n")}`
    );
  }
  if (ctx.choiceText) parts.push(`# 직전 선택\n플레이어가 방금 "${ctx.choiceText}" 를 선택했다. 그 결과로 이어지는 장면이다.`);
  parts.push(`# 이번 장면: ${node.title}\n${node.text}`);
  const userContent = `${parts.join("\n\n")}\n\n---\n위 장면 설정으로 이번 대화 장면을 써라.`;

  const llm = await getLlmSettings();
  const assist = llm.assistProviderId ? await resolveProviderById(Number(llm.assistProviderId)) : null;
  if (assist) {
    const adapter = await createAdapter(assist.provider, assist.account);
    const stream = adapter.streamChat({ system, messages: [{ role: "user", content: userContent }], maxTokens: 1500 });
    let acc = "";
    for await (const d of stream.deltas) acc += d;
    const usage = stream.outcome().usage;
    if (usage) await recordLlmUsage(assist.provider.id, assist.account?.id ?? null, usage);
    return { text: acc.trim(), usage: usage ?? null };
  }
  const response = await new Anthropic().messages.create({
    model: llm.model,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  return {
    text: response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim(),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

// { action: "start" | "restart" | "continue" | "choose" | "scene", optionId?, k? }
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  if (userId == null) return bad("로그인이 필요합니다.", 401);
  const { sid } = await params;
  const body = await req.json().catch(() => ({}));
  const g = await guard(sid, typeof body.k === "string" ? body.k : null, userId);
  if ("res" in g) return g.res;
  const { story, board, char } = g;

  const run = await getStoryRun(userId, story.id);
  let state = run ? runRowToState(run) : null;
  const action = String(body.action ?? "");

  // 현재 스토리 카드의 대화 장면 — 캐시 사용, 없으면 AI 생성 (런×노드당 1회 — 다시 시작하면 캐시가 지워져 재생성)
  if (action === "scene") {
    if (!state || state.finished) return bad("진행 중인 스토리가 없습니다.");
    const node = board.nodes.find((n) => n.id === state!.nodeId);
    if (!node || node.type !== "story") return bad("대화 장면이 있는 카드가 아닙니다.");
    let script = await getStorySceneCache(userId, story.id, node.id);
    let cost = 0;
    let balance: number | null = null;
    if (!script) {
      let generated: Awaited<ReturnType<typeof generateSceneScript>>;
      try {
        generated = await generateSceneScript(story, board, node, char, userId);
      } catch (err) {
        console.error("story scene generate error:", err);
        return NextResponse.json({ error: "장면 생성에 실패했습니다." }, { status: 502 });
      }
      script = generated.text;
      if (!script) return NextResponse.json({ error: "장면 생성 결과가 비어 있습니다." }, { status: 502 });
      await saveStorySceneCache(userId, story.id, node.id, script);
      // 생성 성공 시에만 사용량 기반 과금 (설정 > AI 보조 기능별 과금의 "스토리 플레이 장면" — 캐시 재생은 무과금)
      cost = calcAiAssistCost(resolveAiAssistPricing(await getPricingSettings(), "story_scene"), generated.usage);
      balance = await chargeCoins(userId, cost, "ai_assist_spend", {
        refType: "story",
        refId: story.id,
        memo: `story_scene:${node.id}`,
      });
    }
    return NextResponse.json({ nodeId: node.id, lines: parseSceneLines(script, char.name), cost, balance });
  }

  let view;
  if (action === "start" && state && !state.finished) {
    // 이어하기 — 저장 없이 현재 상태 재표시
    view = viewOfState(board, state);
  } else if (action === "start" || action === "restart") {
    // 새 런 시작: 이전 런의 장면 캐시를 지워 이번 런에서는 AI 가 장면을 새로 생성한다
    await clearStorySceneCache(userId, story.id);
    const begun = startStoryRun(board);
    state = begun.state;
    view = begun.view;
    await saveStoryRun(userId, story.id, story.character_id, state);
  } else if (action === "continue") {
    if (!state || state.finished) return bad("진행 중인 스토리가 없습니다.");
    view = continueStoryRun(board, state);
    await saveStoryRun(userId, story.id, story.character_id, state);
  } else if (action === "choose") {
    if (!state || state.finished) return bad("진행 중인 스토리가 없습니다.");
    const optionId = typeof body.optionId === "string" ? body.optionId : "";
    view = chooseStoryOption(board, state, optionId);
    await saveStoryRun(userId, story.id, story.character_id, state);
  } else {
    return bad("action 이 올바르지 않습니다.");
  }

  return NextResponse.json({
    title: story.title,
    titleImageUrl: story.title_image_url,
    characterName: char.name,
    status: state!.finished ? "finished" : "active",
    view,
  });
}
