import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { requireUser, ownedCharacter, bad } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * 캐릭터 전용 사전 (이 캐릭터만 아는 지식) — 내 캐릭터 기준으로 검증.
 * 캐릭터가 남의 오픈 세계관 소속이어도 동작한다 (world_id 는 캐릭터의 world_id 로 강제).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  // 범위: 이 캐릭터 전용만
  const scopeSql = "d.character_id = ?";
  const args: (string | number)[] = [Number(own.row.world_id), Number(own.row.id)];
  // 검색/페이징 파라미터 (LIKE 의 % _ 는 이스케이프, LIMIT/OFFSET 은 정수 검증 후 삽입)
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const field = sp.get("field") === "content" ? "content" : "title";
  const category = sp.get("category");
  if (category && !["location", "person", "term"].includes(category)) {
    return bad("category 가 올바르지 않습니다.");
  }
  const offset = Number(sp.get("offset") ?? 0);
  const limit = Number(sp.get("limit") ?? 20);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return bad("offset/limit 이 올바르지 않습니다.");
  }
  const suggest = sp.get("suggest") === "1";
  let whereSql = scopeSql;
  if (category) {
    whereSql += " AND d.category = ?";
    args.push(category);
  }
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\$&")}%`;
    if (suggest || field === "title") {
      whereSql += " AND (d.title LIKE ? OR d.aliases LIKE ?)";
      args.push(like, like);
    } else {
      whereSql += " AND d.content LIKE ?";
      args.push(like);
    }
  }
  // 자동완성 모드: 표제어 후보만 가볍게 반환
  if (suggest) {
    if (!q) return NextResponse.json([]);
    const sug = await query(
      `SELECT d.id, d.title FROM world_dictionary d WHERE d.world_id = ? AND ${whereSql} ORDER BY d.title LIMIT 10`,
      args
    );
    return NextResponse.json(sug);
  }
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM world_dictionary d WHERE d.world_id = ? AND ${whereSql}`,
    args
  );
  // 벡터 전체는 UI 로 보내지 않고 존재 여부만 전달
  const rows = await query(
    `SELECT d.id, d.world_id, d.character_id, d.category, d.title, d.aliases, d.content, d.sort_order,
            (d.embedding IS NOT NULL) AS has_embedding
     FROM world_dictionary d
     WHERE d.world_id = ? AND ${whereSql} ORDER BY d.category, d.sort_order, d.id
     LIMIT ${limit} OFFSET ${offset}`,
    args
  );
  return NextResponse.json({ items: rows, total: Number(total) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { id } = await params;
  const own = await ownedCharacter(id, auth.userId);
  if ("res" in own) return own.res;
  const { category, title, aliases = null, content = "", sort_order = 0 } = await req.json().catch(() => ({}));
  if (!["location", "person", "term"].includes(category) || !title) {
    return bad("category, title 은 필수입니다.");
  }
  let embedding: string | null = null;
  let warning: string | undefined;
  try {
    embedding = JSON.stringify(await embedPassage(`${title} ${aliases ?? ""} ${content}`));
  } catch (err) {
    console.error("embedding error:", err);
    warning = "임베딩 생성 실패 — 키워드 검색만 적용됩니다";
  }
  const result = await execute(
    `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(own.row.world_id), Number(own.row.id), category, title, aliases, content, embedding, Number(sort_order) || 0]
  );
  await invalidateChatContext(Number(own.row.id));
  return NextResponse.json({ id: result.insertId, ...(warning && { warning }) }, { status: 201 });
}
