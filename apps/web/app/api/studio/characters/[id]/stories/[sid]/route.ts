import { NextRequest, NextResponse } from "next/server";
import { query, normalizeStoryBoard, updateCharacterStoryDraft, deleteCharacterStory } from "@vchatbot/core";
import { requireUser, bad } from "@/lib/studio";
import { ownedStory } from "@/lib/stories";

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
  return NextResponse.json({
    id: s.id,
    title: s.title,
    status: s.status,
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
  await updateCharacterStoryDraft(g.story.id, title, board);
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
