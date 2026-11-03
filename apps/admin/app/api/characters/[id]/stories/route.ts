import { NextRequest, NextResponse } from "next/server";
import { query, listCharacterStories, createCharacterStory } from "@vchatbot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// 캐릭터의 스토리 목록 (+ 캐릭터/세계관 이름 — 목록 화면 타이틀 표시용)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const chars = await query<{ name: string; world_name: string | null }>(
    "SELECT c.name, w.name AS world_name FROM characters c LEFT JOIN worlds w ON w.id = c.world_id WHERE c.id = ?",
    [Number(id)]
  );
  return NextResponse.json({
    character: { id: Number(id), name: chars[0]?.name ?? "", world_name: chars[0]?.world_name ?? "" },
    stories: await listCharacterStories(Number(id)),
  });
}

// 스토리 생성 { title } → { id }
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const exists = await query("SELECT id FROM characters WHERE id = ?", [Number(id)]);
  if (exists.length === 0) return bad("캐릭터를 찾을 수 없습니다.", 404);
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return bad("제목을 입력하세요.");
  const storyId = await createCharacterStory(Number(id), title);
  return NextResponse.json({ id: storyId }, { status: 201 });
}
