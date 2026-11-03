import { NextRequest, NextResponse } from "next/server";
import { publishCharacterStory, unpublishCharacterStory } from "@vchatbot/core";
import { requireUser } from "@/lib/studio";
import { ownedStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

/**
 * POST { action: "publish" | "unpublish" }
 * publish 는 draft 보드를 검증해 통과 시 published 로 복사. 실패하면 { errors: string[] }.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id, sid } = await params;
  const g = await ownedStory(id, sid, auth.userId);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => ({}));
  if (body.action === "unpublish") {
    await unpublishCharacterStory(g.story.id);
    return NextResponse.json({ ok: true });
  }
  const errors = await publishCharacterStory(g.story.id);
  if (errors) return NextResponse.json({ ok: false, errors }, { status: 422 });
  return NextResponse.json({ ok: true });
}
