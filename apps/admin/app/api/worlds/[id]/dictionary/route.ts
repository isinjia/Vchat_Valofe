import { NextRequest, NextResponse } from "next/server";
import { query, execute, embedPassage, invalidateChatContext } from "@vchatbot/core";
import { resolveCharacterScope } from "@/lib/dictionary-scope";

const badReq = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });
type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  // 범위: characterId 생략=공용만(character_id IS NULL), 지정=그 캐릭터 전용만
  const cid = req.nextUrl.searchParams.get("characterId");
  let scopeSql = "d.character_id IS NULL";
  const args: (string | number)[] = [id];
  if (cid) {
    const n = Number(cid);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "characterId 가 올바르지 않습니다." }, { status: 400 });
    }
    scopeSql = "d.character_id = ?";
    args.push(n);
  }
  // 검색/페이징 파라미터 (LIKE 의 % _ 는 이스케이프, LIMIT/OFFSET 은 정수 검증 후 삽입)
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const field = sp.get("field") === "content" ? "content" : "title";
  const category = sp.get("category");
  if (category && !["location", "person", "term"].includes(category)) {
    return badReq("category 가 올바르지 않습니다.");
  }
  const offset = Number(sp.get("offset") ?? 0);
  const limit = Number(sp.get("limit") ?? 20);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return badReq("offset/limit 이 올바르지 않습니다.");
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
    `SELECT d.id, d.world_id, d.character_id, c.name AS character_name,
            d.linked_character_id, lc.name AS linked_character_name,
            d.category, d.title, d.aliases, d.content, d.sort_order,
            (d.embedding IS NOT NULL) AS has_embedding
     FROM world_dictionary d LEFT JOIN characters c ON c.id = d.character_id
     LEFT JOIN characters lc ON lc.id = d.linked_character_id
     WHERE d.world_id = ? AND ${whereSql} ORDER BY d.category, d.sort_order, d.id
     LIMIT ${limit} OFFSET ${offset}`,
    args
  );
  return NextResponse.json({ items: rows, total: Number(total) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { category, title, aliases = null, content = "", sort_order = 0, character_id = null } = await req.json();
  if (!category || !title) {
    return NextResponse.json({ error: "category, title 은 필수입니다." }, { status: 400 });
  }
  // 범위: null=세계관 공통, 값=해당 캐릭터 전용 (세계관 소속 검증)
  const scope = await resolveCharacterScope(id, character_id);
  if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: 400 });
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
    [id, scope.characterId, category, title, aliases, content, embedding, sort_order]
  );
  await invalidateChatContext();
  return NextResponse.json({ id: result.insertId, ...(warning && { warning }) }, { status: 201 });
}
