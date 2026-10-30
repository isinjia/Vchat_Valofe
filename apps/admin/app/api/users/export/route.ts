import { NextRequest, NextResponse } from "next/server";
import { query } from "@vchatbot/core";
import { buildUserWhere } from "../filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 10000;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 현재 필터(q, status, tierId, creatorTierId)가 적용된 유저 CSV (최대 10,000행, UTF-8 BOM) */
export async function GET(req: NextRequest) {
  const { whereSql, params } = buildUserWhere(req.nextUrl.searchParams);
  const rows = await query<Record<string, unknown>>(
    `SELECT u.id, u.username, u.nickname, u.status, u.coins, u.created_at,
            t.name AS tier_name, ct.name AS creator_tier_name, al.name AS ai_level_name
     FROM users u
     LEFT JOIN chat_tiers t ON t.id = u.tier_id
     LEFT JOIN chat_tiers ct ON ct.id = u.creator_tier_id
     LEFT JOIN ai_levels al ON al.id = u.ai_level_id
     ${whereSql}
     ORDER BY u.id DESC LIMIT ?`,
    [...params, MAX_ROWS]
  );
  const header = ["id", "username", "nickname", "status", "유저등급명", "크리에이터등급명", "AI레벨명", "coins", "created_at"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, r.username, r.nickname, r.status, r.tier_name, r.creator_tier_name, r.ai_level_name, r.coins, r.created_at]
        .map(csvCell)
        .join(",")
    );
  }
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="users.csv"',
    },
  });
}
