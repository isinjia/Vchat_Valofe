import { cookies } from "next/headers";
import { execute, query } from "@vchatbot/core";

const COOKIE_NAME = "vc_uid";

/**
 * 게스트 유저를 보장한다 (로그인 기능 전 임시).
 * Route Handler 안에서만 호출할 것 (cookies().set 제약).
 */
export async function getOrCreateGuestUser(): Promise<number> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) {
    const id = Number(existing);
    if (Number.isInteger(id) && id > 0) {
      const rows = await query("SELECT id FROM users WHERE id = ?", [id]);
      if (rows.length > 0) return id;
    }
  }
  const username = `guest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const result = await execute("INSERT INTO users (username, nickname) VALUES (?, ?)", [
    username,
    "게스트",
  ]);
  store.set(COOKIE_NAME, String(result.insertId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return result.insertId;
}

/** 쿠키에 있는 유저 ID 를 읽기만 한다 (없으면 null) */
export async function getUserId(): Promise<number | null> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}
