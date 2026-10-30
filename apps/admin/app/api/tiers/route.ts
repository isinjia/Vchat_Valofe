import { NextRequest, NextResponse } from "next/server";
import { query, execute, type ChatTier } from "@vchatbot/core";
import { sanitizeConditions } from "./conditions";

export const dynamic = "force-dynamic";

export async function GET() {
  const tiers = await query<ChatTier>("SELECT * FROM chat_tiers ORDER BY track, tier_rank");
  return NextResponse.json(tiers);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const { name, description = "" } = b;
  if (!name) return NextResponse.json({ error: "name 은 필수입니다." }, { status: 400 });
  const track = b.track ?? "user";
  if (track !== "user" && track !== "creator") {
    return NextResponse.json({ error: "track 은 user/creator 만 가능합니다." }, { status: 400 });
  }
  const rank = b.tier_rank === undefined || b.tier_rank === "" ? 0 : Number(b.tier_rank);
  if (!Number.isInteger(rank) || rank < 0) {
    return NextResponse.json({ error: "tier_rank 는 0 이상 정수여야 합니다." }, { status: 400 });
  }
  const chatCost = Math.max(0, Math.floor(Number(b.chat_cost) || 0));
  const discount = Math.min(100, Math.max(0, Number(b.discount_rate) || 0));
  const feeBonus = Math.max(0, Number(b.fee_bonus) || 0);
  const result = await execute(
    `INSERT INTO chat_tiers (name, description, track, tier_rank, chat_cost, discount_rate, fee_bonus, conditions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, description || null, track, rank, chatCost, discount, feeBonus, sanitizeConditions(b.conditions)]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
