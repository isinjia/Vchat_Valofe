/**
 * 타이틀 컬러(#rrggbb)를 현재 테마 배경(--bg)에 블렌딩한 톤을 만든다.
 * CSS color-mix 를 쓰므로 낮/밤 스킨 전환 시 자동으로 해당 테마 배경에 맞춰진다.
 * strength: 컬러 혼합 비율 (0~1, 기본 0.18 — 홈 카드와 동일)
 */
export function tintBackground(hex: string | null | undefined, strength = 0.18): string | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `color-mix(in srgb, ${hex} ${Math.round(strength * 100)}%, var(--bg))`;
}

/** 페이지 상단에서 배경색으로 자연스럽게 사라지는 세로 그라데이션 배경 */
export function tintGradient(hex: string | null | undefined, strength = 0.14, fadePx = 480): string | null {
  const t = tintBackground(hex, strength);
  return t ? `linear-gradient(180deg, ${t} 0, var(--bg) ${fadePx}px)` : null;
}
