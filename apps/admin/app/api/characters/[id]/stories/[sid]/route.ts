import { NextRequest, NextResponse } from "next/server";
import { query, normalizeStoryBoard, updateCharacterStoryDraft, deleteCharacterStory } from "@vchatbot/core";
import { storyOf } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// 스토리 1건 (편집용 — draft 보드)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
  if ("res" in g) return g.res;
  const s = g.story;
  const chars = await query<{ name: string; world_name: string | null }>(
    "SELECT c.name, w.name AS world_name FROM characters c LEFT JOIN worlds w ON w.id = c.world_id WHERE c.id = ?",
    [Number(id)]
  );
  return NextResponse.json({
    id: s.id,
    title: s.title,
    title_image_url: s.title_image_url,
    status: s.status,
    board: normalizeStoryBoard(JSON.parse(s.draft_json)),
    published_at: s.published_at,
    character: { name: chars[0]?.name ?? "", world_name: chars[0]?.world_name ?? "" },
  });
}

// 임시저장 { title, board }
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return bad("제목을 입력하세요.");
  const titleImage = typeof body.title_image_url === "string" && body.title_image_url ? body.title_image_url : null;
  await updateCharacterStoryDraft(g.story.id, title, normalizeStoryBoard(body.board), titleImage);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
  if ("res" in g) return g.res;
  await deleteCharacterStory(g.story.id);
  return NextResponse.json({ ok: true });
}
