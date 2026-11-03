import { NextRequest, NextResponse } from "next/server";
import { publishCharacterStory, unpublishCharacterStory } from "@vchatbot/core";
import { storyOf } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sid: string }> };

/** POST { action: "publish" | "unpublish" } — publish 실패 시 { errors } */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, sid } = await params;
  const g = await storyOf(id, sid);
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
