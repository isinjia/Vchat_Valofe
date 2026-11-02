"use client";

import { useEffect, useState } from "react";
import { studioFetch } from "./studio-api";
import CoinIcon from "../components/CoinIcon";

/** 스튜디오 수수료 정산: 지난달/이번달 요약 + 최근 6개월 추이 + 캐릭터별·아이템별 상세 */

interface Sum {
  month: string;
  chat: number;
  gift: number;
  world: number;
  total: number;
}

interface Earnings {
  thisMonth: Sum;
  lastMonth: Sum;
  monthly: Sum[];
  detailMonth: string;
  byCharacter: { characterId: number; name: string; chatCount: number; chatFee: number; giftCount: number; giftFee: number }[];
  byItem: { name: string; count: number; sales: number; fee: number }[];
}

const fmt = (n: number) => n.toLocaleString();

export default function EarningsSection() {
  const [data, setData] = useState<Earnings | null>(null);
  const [month, setMonth] = useState(""); // 상세 조회 월 ("" = 이번 달)

  useEffect(() => {
    studioFetch(`/api/studio/earnings${month ? `?month=${month}` : ""}`)
      .then((r) => r.json())
      .then((d) => setData(d.error ? null : d))
      .catch(() => {});
  }, [month]);

  if (!data) return null;

  const Tile = ({ label, sum }: { label: string; sum: Sum }) => (
    <div className="panel" style={{ flex: "1 1 200px", margin: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>
        <CoinIcon size={16} /> {fmt(sum.total)}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{label} ({sum.month})</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        채팅 {fmt(sum.chat)} · 선물 {fmt(sum.gift)} · 세계관 {fmt(sum.world)}
      </div>
    </div>
  );

  return (
    <>
      <h3>수수료 정산</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Tile label="이번 달 수수료 (현재까지)" sum={data.thisMonth} />
        <Tile label="지난달 수수료" sum={data.lastMonth} />
      </div>

      <div className="panel">
        <label>월간 수수료 추이 (최근 6개월)</label>
        <table>
          <thead>
            <tr><th>월</th><th>채팅</th><th>선물</th><th>세계관</th><th>합계</th></tr>
          </thead>
          <tbody>
            {data.monthly.map((m) => (
              <tr key={m.month}>
                <td>{m.month}</td>
                <td>{fmt(m.chat)}</td>
                <td>{fmt(m.gift)}</td>
                <td>{fmt(m.world)}</td>
                <td><b>{fmt(m.total)}</b></td>
              </tr>
            ))}
            {data.monthly.length === 0 && <tr><td colSpan={5} className="muted">수수료 내역이 없습니다.</td></tr>}
          </tbody>
        </table>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 6px" }}>
          <label style={{ margin: 0 }}>상세 내역 조회 월</label>
          <select value={month || data.thisMonth.month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }}>
            {[data.thisMonth.month, ...data.monthly.map((m) => m.month).filter((m) => m !== data.thisMonth.month)]
              .sort()
              .reverse()
              .map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
          </select>
        </div>

        <label>캐릭터별 상세 ({data.detailMonth})</label>
        <table>
          <thead>
            <tr><th>캐릭터</th><th>대화(수수료 발생)</th><th>채팅 수수료</th><th>선물 판매수</th><th>선물 수수료</th><th>합계</th></tr>
          </thead>
          <tbody>
            {data.byCharacter.map((c) => (
              <tr key={c.characterId}>
                <td>{c.name}</td>
                <td>{fmt(c.chatCount)}</td>
                <td>{fmt(c.chatFee)}</td>
                <td>{fmt(c.giftCount)}</td>
                <td>{fmt(c.giftFee)}</td>
                <td><b>{fmt(c.chatFee + c.giftFee)}</b></td>
              </tr>
            ))}
            {data.byCharacter.length === 0 && <tr><td colSpan={6} className="muted">이 달의 수수료 내역이 없습니다.</td></tr>}
          </tbody>
        </table>

        <label style={{ marginTop: 12 }}>아이템별 판매 상세 ({data.detailMonth})</label>
        <table>
          <thead>
            <tr><th>아이템</th><th>판매수</th><th>판매액</th><th>내 수수료</th></tr>
          </thead>
          <tbody>
            {data.byItem.map((it) => (
              <tr key={it.name}>
                <td>{it.name}</td>
                <td>{fmt(it.count)}</td>
                <td>{fmt(it.sales)}</td>
                <td><b>{fmt(it.fee)}</b></td>
              </tr>
            ))}
            {data.byItem.length === 0 && <tr><td colSpan={4} className="muted">이 달의 선물 판매가 없습니다.</td></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          내 수수료 = 판매액 × 아이템 수수료율(크리에이터 등급 가산 포함) − 세계관 소유자 분배분. 본인 사용분은 제외됩니다.
        </p>
      </div>
    </>
  );
}
