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

/** /api/studio/pricing 응답 */
export interface PricingInfo {
  aiAssistCost: number;
  illustGenCost: number;
  videoGenCost: number;
  aiAssist: Record<string, { coinsPer1k: number; minCost: number }>;
  byok: { enabled: boolean; cost: number; hasKey: boolean };
  /** 업로드 용량 제한 (MB) — 전역 쿼터 + 크리에이터 등급별 차등 적용 후 */
  limits?: { videoMaxMb: number; effectMaxMb: number };
}

/** AI 생성 버튼의 kind별 비용 라벨 (BYOK 정액 / 토큰 비례 "N~" / 정액) */
export function aiCostLabel(p: PricingInfo | null, kind: string): string {
  if (!p) return "";
  if (p.byok?.enabled && p.byok.hasKey) return ` (-${p.byok.cost.toLocaleString()}코인)`;
  const pr = p.aiAssist?.[kind] ?? { coinsPer1k: 0, minCost: p.aiAssistCost };
  return pr.coinsPer1k > 0 ? ` (-${pr.minCost.toLocaleString()}~코인)` : ` (-${pr.minCost.toLocaleString()}코인)`;
}
