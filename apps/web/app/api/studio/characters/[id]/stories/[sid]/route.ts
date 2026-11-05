import { NextRequest, NextResponse } from "next/server";
import { query, normalizeStoryBoard, updateCharacterStoryDraft, deleteCharacterStory, storyInheritedAdult } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";
import { ownedStory } from "@/lib/stories";
import { isAdultUser } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

// 스토리 1건 (편집용 — draft 보드)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
  if ("res" in g) return g.res;
  const s = g.story;
  const ws = await query<{ name: string }>("SELECT name FROM worlds WHERE id = ?", [Number(g.characterRow.world_id)]);
  const inheritedAdult = await storyInheritedAdult(Number(id));
  return NextResponse.json({
    id: s.id,
    title: s.title,
    title_image_url: s.title_image_url,
    status: s.status,
    is_adult: inheritedAdult || Number(s.is_adult) === 1,
    inherited_adult: inheritedAdult,
    // 제작자 본인의 성인 인증 여부 — false 면 19금 토글 잠금
    viewer_is_adult: await isAdultUser(auth.userId),
    board: normalizeStoryBoard(JSON.parse(s.draft_json)),
    published_at: s.published_at,
    character: { name: String(g.characterRow.name ?? ""), world_name: ws[0]?.name ?? "" },
  });
}

// 임시저장 { title, board } — 미완성 연결 허용
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return bad("제목을 입력하세요.");
  const board = normalizeStoryBoard(body.board);
  const titleImage = typeof body.title_image_url === "string" && body.title_image_url ? body.title_image_url : null;
  // 캐릭터/세계관이 19금이면 스토리도 강제 19금
  const inheritedAdult = await storyInheritedAdult(Number(id));
  // 19금 설정은 성인 인증된 제작자만 (상속이면 통과 — 이미 19금인 스토리 저장 유지)
  if (!inheritedAdult && body.is_adult === true && Number(g.story.is_adult) !== 1 && !(await isAdultUser(auth.userId))) {
    return bad("19금 설정은 성인 인증된 계정만 할 수 있습니다.", 403);
  }
  const isAdult = inheritedAdult || body.is_adult === true;
  await updateCharacterStoryDraft(g.story.id, title, board, titleImage, isAdult);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
  if ("res" in g) return g.res;
  await deleteCharacterStory(g.story.id);
  return NextResponse.json({ ok: true });
}
