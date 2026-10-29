"use client";

import { useEffect, useState } from "react";

interface MaxItem {
  tokensIn?: number;
  tokensOut?: number;
  userId: number;
  userName: string | null;
  characterId: number;
  characterName: string | null;
  createdAt: string;
}

interface Usage {
  overall: {
    messages: number;
    totalIn: number;
    totalOut: number;
    avgIn: number;
    avgOut: number;
    cacheRead: number;
  };
  max: { input: MaxItem | null; output: MaxItem | null };
  topUsers: {
    userId: number;
    nickname: string | null;
    messages: number;
    totalIn: number;
    totalOut: number;
    avgIn: number;
    avgOut: number;
    maxIn: number;
    maxOut: number;
  }[];
  byModel: { model: string; messages: number; totalIn: number; totalOut: number }[];
}

const PERIODS = [
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
  { days: 0, label: "전체" },
];

const fmt = (n: number) => n.toLocaleString();

/** 단일 대화 최대 한 줄 설명 */
function maxLine(label: string, m: MaxItem | null, value?: number) {
  if (!m) return <p className="muted">{label}: -</p>;
  return (
    <p>
      {label} <b>{fmt(value ?? 0)}</b>{" "}
      <span className="muted">
        (유저 {m.userName ?? `#${m.userId}`} · 캐릭터 {m.characterName ?? `#${m.characterId}`} ·{" "}
        {new Date(m.createdAt).toLocaleString()})
      </span>
    </p>
  );
}

export default function StatsPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/usage?days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [days]);

  const o = data?.overall;

  return (
    <>
      <h2>사용량 통계</h2>
      <div className="panel">
        <div style={{ display: "flex", gap: 8 }}>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              style={{ marginTop: 0, opacity: days === p.days ? 1 : 0.5 }}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
          {loading && <span className="muted" style={{ alignSelf: "center" }}>불러오는 중...</span>}
        </div>
      </div>

      {data && o && o.messages === 0 && (
        <div className="panel">
          <p className="muted">아직 토큰이 기록된 대화가 없습니다.</p>
        </div>
      )}

      {data && o && o.messages > 0 && (
        <>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>메시지 수</th>
                  <th>총 입력 토큰</th>
                  <th>총 출력 토큰</th>
                  <th>평균 입력</th>
                  <th>평균 출력</th>
                  <th>캐시 히트 토큰</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{fmt(o.messages)}</td>
                  <td>{fmt(o.totalIn)}</td>
                  <td>{fmt(o.totalOut)}</td>
                  <td>{fmt(o.avgIn)}</td>
                  <td>{fmt(o.avgOut)}</td>
                  <td>{fmt(o.cacheRead)}</td>
                </tr>
              </tbody>
            </table>
            <h3>단일 대화 최대</h3>
            {maxLine("최대 입력", data.max.input, data.max.input?.tokensIn)}
            {maxLine("최대 출력", data.max.output, data.max.output?.tokensOut)}
          </div>

          <h3>유저별 사용량 TOP 20</h3>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>유저</th><th>메시지수</th><th>총입력</th><th>총출력</th>
                  <th>평균입력</th><th>평균출력</th><th>최대입력</th><th>최대출력</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((u) => (
                  <tr key={u.userId}>
                    <td>{u.nickname ?? `#${u.userId}`}</td>
                    <td>{fmt(u.messages)}</td>
                    <td>{fmt(u.totalIn)}</td>
                    <td>{fmt(u.totalOut)}</td>
                    <td>{fmt(u.avgIn)}</td>
                    <td>{fmt(u.avgOut)}</td>
                    <td>{fmt(u.maxIn)}</td>
                    <td>{fmt(u.maxOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>모델별 사용량</h3>
          <div className="panel">
            <table>
              <thead>
                <tr><th>모델</th><th>메시지수</th><th>총입력</th><th>총출력</th></tr>
              </thead>
              <tbody>
                {data.byModel.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td>{fmt(m.messages)}</td>
                    <td>{fmt(m.totalIn)}</td>
                    <td>{fmt(m.totalOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
