import { env } from "@vchatbot/core";

/** 인증 환경: dev 는 stage 서버를 사용한다 */
export type AppEnv = "dev" | "stage" | "live";

export function getAppEnv(): AppEnv {
  const v = env("APP_ENV", "dev");
  return v === "live" || v === "stage" ? v : "dev";
}

interface VfunEndpoints {
  tokenUrl: string;
  userUrl: string;
  referer: string;
  /** 토큰 키 접두사 (live: L-, stage/dev: S-) */
  prefix: "L" | "S";
}

function endpoints(): VfunEndpoints {
  if (getAppEnv() === "live") {
    return {
      tokenUrl: "https://vfun-api-kr.valofe.com/api/launcher/oauth/token",
      userUrl: "https://auth-kr.valofe.com/api/user",
      referer: "https://vfunkr.valofe.com/",
      prefix: "L",
    };
  }
  return {
    tokenUrl: "https://vfun-api-kr-stage.valofe.com/api/launcher/oauth/token",
    userUrl: "https://auth-kr-stage.valofe.com/api/user",
    referer: "https://vfunkr-stage.valofe.com/",
    prefix: "S",
  };
}

const SCOPE = "read write profile email birthday";
const TIMEOUT_MS = 10_000;

export interface VfunTokenResult {
  ok: boolean;
  accessToken?: string;
  expiresIn?: number;
  /** vfun result 코드 (4073: OTP 필요, 4057/4059: 해외/차단 IP) */
  resultCode?: number;
  message?: string;
}

export interface VfunUser {
  uNo: number;
  userId: string;
  nickname: string;
  profileImage: string | null;
}

/** 토큰 엔드포인트 공통 호출 (토큰/비밀번호는 로그에 남기지 않는다) */
async function postToken(
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<VfunTokenResult> {
  const ep = endpoints();
  let res: Response;
  try {
    res = await fetch(ep.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Referer: ep.referer,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "인증 서버에 연결할 수 없습니다." };
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!json) return { ok: false, message: `인증 서버 응답 오류 (${res.status})` };

  const result = Number(json.result);
  if (res.status === 200 && result === 1) {
    // 환경 접두사가 붙은 키 우선, 둘 다 시도
    const token = (json[`${ep.prefix}-Access-Token`] ?? json["L-Access-Token"] ?? json["S-Access-Token"]) as
      | string
      | undefined;
    if (!token) return { ok: false, message: "액세스 토큰이 응답에 없습니다." };
    return { ok: true, accessToken: token, expiresIn: Number(json.expires_in) || undefined, resultCode: 1 };
  }
  const msg = (json.msg ?? json.message) as string | undefined;
  return {
    ok: false,
    resultCode: Number.isFinite(result) ? result : undefined,
    message: msg || "인증에 실패했습니다.",
  };
}

/** authcode 교환 (authcode 는 1회용 — 호출 측에서 1번만 호출할 것) */
export function exchangeAuthCode(code: string): Promise<VfunTokenResult> {
  return postToken({ grant_type: "authcode_login", auth_code: code, scope: SCOPE });
}

/** id/pw 로그인 (dev/stage 전용). otp 가 있으면 otp_verified 로 재시도 */
export function loginWithPassword(username: string, password: string, otp?: string): Promise<VfunTokenResult> {
  const headers = { Device: "launcher", "Device-Id": crypto.randomUUID() };
  if (otp) {
    return postToken({ grant_type: "otp_verified", username, otp, scope: SCOPE }, headers);
  }
  return postToken({ grant_type: "password", username, password, scope: SCOPE }, headers);
}

/** 액세스 토큰으로 vfun 유저 정보 조회 */
export async function fetchVfunUser(accessToken: string): Promise<VfunUser | null> {
  const ep = endpoints();
  try {
    const res = await fetch(ep.userUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Referer: ep.referer },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status !== 200) return null;
    const json = (await res.json()) as { result?: number; data?: Record<string, unknown> };
    if (Number(json.result) !== 1 || !json.data) return null;
    const d = json.data;
    const uNo = Number(d.u_no ?? d.id);
    if (!Number.isInteger(uNo) || uNo <= 0) return null;
    const userId = String(d.user_id ?? "");
    return {
      uNo,
      userId,
      nickname: String(d.nickname || userId || `user${uNo}`).slice(0, 64),
      profileImage: d.profile_image ? String(d.profile_image) : null,
    };
  } catch {
    return null;
  }
}
