import { NextRequest, NextResponse } from "next/server";
import { addSanction, listSanctions } from "@vchatbot/core";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

/** GET ?targetType=user|character&targetId= — 제재 이력 (최신순) */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const targetType = sp.get("targetType");
  const targetId = Number(sp.get("targetId"));
  if ((targetType !== "user" && targetType !== "character") || !Number.isInteger(targetId) || targetId < 1) {
    return NextResponse.json({ error: "targetType, targetId 가 올바르지 않습니다." }, { status: 400 });
  }
  return NextResponse.json(await listSanctions(targetType, targetId));
}

/**
 * POST { target_type, target_id, kind, days, reason? } — 제재 등록
 * user: chat_block(모든 채팅 금지) | new_chat_block(신규 채팅 시작 금지)
 * character: hide(기간제 비공개)
 * admin_id 는 통합 관리자 인증 도입 전까지 NULL 로 기록된다.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const targetType = b.target_type;
  const targetId = Number(b.target_id);
  const kind = b.kind;
  const days = Number(b.days);
  if ((targetType !== "user" && targetType !== "character") || !Number.isInteger(targetId) || targetId < 1) {
    return NextResponse.json({ error: "target_type, target_id 가 올바르지 않습니다." }, { status: 400 });
  }
  const allowed = targetType === "user" ? ["chat_block", "new_chat_block", "admin_block"] : ["hide"];
  if (!allowed.includes(kind)) {
    return NextResponse.json({ error: `이 대상에는 ${allowed.join(", ")} 제재만 가능합니다.` }, { status: 400 });
  }
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: "days 는 1~365 사이여야 합니다." }, { status: 400 });
  }
  const session = await getAdminSession();
  const { id, endsAt } = await addSanction({
    targetType,
    targetId,
    kind,
    days,
    reason: typeof b.reason === "string" ? b.reason.slice(0, 255) : null,
    adminId: session?.uid ?? null,
  });
  return NextResponse.json({ id, endsAt }, { status: 201 });
}
