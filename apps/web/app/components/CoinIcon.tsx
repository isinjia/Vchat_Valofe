/** 코인 아이콘 — 🪙 이모지는 Windows 10 등 구형 글꼴에 없어 깨지므로 인라인 SVG 로 그린다 */
export default function CoinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "-2px", flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="7" fill="#f2c94c" stroke="#a8781a" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="#c99b2e" strokeWidth="1" />
      <text x="8" y="11.1" textAnchor="middle" fontSize="8" fontWeight="700" fill="#7a5a00">C</text>
    </svg>
  );
}
