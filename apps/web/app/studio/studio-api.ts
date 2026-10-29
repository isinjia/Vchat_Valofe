// 스튜디오 페이지 공통 fetch 헬퍼: 401 이면 /login 으로 이동
export async function studioFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.replace("/login");
    // 이동 중에는 이후 처리가 진행되지 않도록 영원히 대기
    return new Promise<Response>(() => {});
  }
  return res;
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
