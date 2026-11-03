import { NextRequest, NextResponse } from "next/server";
import { query, listCharacterStories, createCharacterStory } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// 내 캐릭터의 스토리 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const ws = await query<{ name: string }>("SELECT name FROM worlds WHERE id = ?", [Number(own.row.world_id)]);
  return NextResponse.json({
    character: { id: Number(id), name: String(own.row.name ?? ""), world_name: ws[0]?.name ?? "" },
    stories: await listCharacterStories(Number(id)),
  });
}

// 스토리 생성 { title } → { id }
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return bad("제목을 입력하세요.");
  const storyId = await createCharacterStory(Number(id), title);
  return NextResponse.json({ id: storyId }, { status: 201 });
}
