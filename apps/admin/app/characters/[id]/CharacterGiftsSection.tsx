"use client";

import { useEffect, useState } from "react";

/** 캐릭터가 받은 선물: 아이템별 집계 + 최근 사용 내역 */

interface GiftData {
  summary: { item_name: string; cnt: number; total: number; users: number }[];
  recent: { id: number; item_name: string; price: number; affinity_applied: number; created_at: string; user_nickname: string | null; user_id: number | null }[];
  totalCount: number;
  totalAmount: number;
}

const fmt = (n: number) => Number(n).toLocaleString();

export default function CharacterGiftsSection({ characterId }: { characterId: string | number }) {
  const [data, setData] = useState<GiftData | null>(null);

  useEffect(() => {
    fetch(`/api/characters/${characterId}/gifts`)
      .then((r) => r.json())
      .then((d) => setData(d.error ? null : d))
      .catch(() => {});
  }, [characterId]);

  if (!data) return <p className="muted">불러오는 중...</p>;

  return (
    <>
      <h3>받은 선물 (총 {fmt(data.totalCount)}건 · {fmt(data.totalAmount)}코인)</h3>
      <div className="panel">
        <label>아이템별 집계</label>
        <table>
          <thead><tr><th>아이템</th><th>받은 수</th><th>금액</th><th>선물한 유저 수</th></tr></thead>
          <tbody>
            {data.summary.map((s) => (
              <tr key={s.item_name}>
                <td>{s.item_name}</td>
                <td>{fmt(s.cnt)}</td>
                <td>{fmt(s.total)}</td>
                <td>{fmt(s.users)}</td>
              </tr>
            ))}
            {data.summary.length === 0 && <tr><td colSpan={4} className="muted">받은 선물이 없습니다.</td></tr>}
          </tbody>
        </table>

        {data.recent.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>최근 내역 (100건)</label>
            <table>
              <thead><tr><th>일시</th><th>아이템</th><th>보낸 유저</th><th>가격</th><th>호감도 적용</th></tr></thead>
              <tbody>
                {data.recent.map((u) => (
                  <tr key={u.id}>
                    <td className="muted">{new Date(u.created_at).toLocaleString()}</td>
                    <td>{u.item_name}</td>
                    <td>
                      {u.user_id ? (
                        <a href={`/users/${u.user_id}`} style={{ textDecoration: "underline" }}>
                          {u.user_nickname ?? `#${u.user_id}`}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{fmt(u.price)}</td>
                    <td>{u.affinity_applied > 0 ? `+${fmt(u.affinity_applied)}` : fmt(u.affinity_applied)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
