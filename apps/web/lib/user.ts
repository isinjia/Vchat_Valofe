import { execute, query } from "@vchatbot/core";
import { getSessionUserId } from "@/lib/session";
import type { VfunUser } from "@/lib/vfun";

/** 세션 쿠키 기반 로그인 유저 ID (비로그인이면 null) */
export async function getUserId(): Promise<number | null> {
  return getSessionUserId();
}

/**
 * 성인 판정 (청소년보호법 '연 나이' 기준 — 만 19세가 되는 해의 1월 1일부터 성인).
 * birthday 가 없으면 null (미확인).
 */
export function isAdultByBirthday(birthday: string | null, now: Date = new Date()): number | null {
  if (!birthday) return null;
  const birthYear = Number(birthday.slice(0, 4));
  if (!Number.isInteger(birthYear) || birthYear < 1900) return null;
  return now.getFullYear() - birthYear >= 19 ? 1 : 0;
}

/** 19금 콘텐츠 차단 안내 (미성년자 + 성인 여부 미확인 모두 포함) */
export const ADULT_BLOCK_MESSAGE = "19세 이상만 이용할 수 있는 콘텐츠입니다. VFUN 계정의 성인 인증(생일 정보)이 필요합니다.";

/**
 * 뷰어가 성인으로 확인된 유저인지 (users.is_adult = 1).
 * 비로그인 · 미확인(NULL) · 미성년(0) 은 모두 false — 19금 콘텐츠 접근 불가.
 */
export async function isAdultUser(userId: number | null): Promise<boolean> {
  if (userId == null) return false;
  const rows = await query<{ is_adult: number | null }>("SELECT is_adult FROM users WHERE id = ?", [userId]);
  return Number(rows[0]?.is_adult ?? 0) === 1;
}

/**
 * vfun 유저를 users 에 반영(없으면 생성)하고 users.id 를 반환.
 * users.id 는 vfun u_no 와 동일하게 통일한다 (로컬/게스트 계정은 10억대 AUTO_INCREMENT 로 충돌 방지).
 * 닉네임은 vfun 쪽에서 바뀔 수 있으므로 로그인할 때마다 갱신한다.
 * 생일/성인 여부는 응답에 생일이 있을 때만 갱신한다 (이미 아는 값을 지우지 않는다).
 */
export async function upsertVfunUser(u: VfunUser): Promise<number> {
  const adult = isAdultByBirthday(u.birthday);
  const rows = await query<{ id: number }>("SELECT id FROM users WHERE vfun_u_no = ?", [u.uNo]);
  if (rows.length > 0) {
    await execute(
      `UPDATE users SET nickname = ?, profile_image = ?, vfun_user_id = ?,
         birthday = COALESCE(?, birthday), is_adult = COALESCE(?, is_adult)
       WHERE id = ?`,
      [u.nickname, u.profileImage, u.userId || null, u.birthday, adult, rows[0].id]
    );
    return rows[0].id;
  }
  await execute(
    "INSERT INTO users (id, username, nickname, vfun_u_no, vfun_user_id, profile_image, birthday, is_adult) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [u.uNo, `vfun_${u.uNo}`, u.nickname, u.uNo, u.userId || null, u.profileImage, u.birthday, adult]
  );
  return u.uNo;
}
