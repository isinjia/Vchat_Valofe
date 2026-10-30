import { execute, query } from "@vchatbot/core";
import { getSessionUserId } from "@/lib/session";
import type { VfunUser } from "@/lib/vfun";

/** 세션 쿠키 기반 로그인 유저 ID (비로그인이면 null) */
export async function getUserId(): Promise<number | null> {
  return getSessionUserId();
}

/**
 * vfun 유저를 users 에 반영(없으면 생성)하고 users.id 를 반환.
 * users.id 는 vfun u_no 와 동일하게 통일한다 (로컬/게스트 계정은 10억대 AUTO_INCREMENT 로 충돌 방지).
 * 닉네임은 vfun 쪽에서 바뀔 수 있으므로 로그인할 때마다 갱신한다.
 */
export async function upsertVfunUser(u: VfunUser): Promise<number> {
  const rows = await query<{ id: number }>("SELECT id FROM users WHERE vfun_u_no = ?", [u.uNo]);
  if (rows.length > 0) {
    await execute("UPDATE users SET nickname = ?, profile_image = ?, vfun_user_id = ? WHERE id = ?", [
      u.nickname,
      u.profileImage,
      u.userId || null,
      rows[0].id,
    ]);
    return rows[0].id;
  }
  await execute(
    "INSERT INTO users (id, username, nickname, vfun_u_no, vfun_user_id, profile_image) VALUES (?, ?, ?, ?, ?, ?)",
    [u.uNo, `vfun_${u.uNo}`, u.nickname, u.uNo, u.userId || null, u.profileImage]
  );
  return u.uNo;
}
