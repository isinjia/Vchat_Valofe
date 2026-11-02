"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

interface DailyItem { date: string; nu: number; dau: number; pu: number; messages: number; coinsSpent: number }
interface ContentCounts { worlds: number; worldsOpen: number; characters: number; charactersOpen: number }
interface CcuItem { hour: string; users: number; messages: number }
interface RankData {
  topUsers: { id: number; vfunUserId: string | null; uNo: number | null; nickname: string | null; messages: number }[];
  topCharacters: { id: number; name: string; worldName: string; messages: number; users: number }[];
  topItems: { name: string; worldName: string; count: number; sales: number }[];
  topGifted: { id: number; name: string; worldName: string; count: number; amount: number; users: number }[];
}
interface SalesItem { date: string; gift: number; chat: number; support: number; total: number }
interface SalesData { days: number; items: SalesItem[]; totals: { gift: number; chat: number; support: number; total: number } }
type Tab = "metrics" | "sales" | "ai" | "rank";
const SALES_RANGES = [7, 14, 30];
const CCU_RANGES = [{ hours: 24, label: "24시간" }, { hours: 48, label: "48시간" }, { hours: 168, label: "7일" }];

interface ShareData {
  total: number;
  worlds: { id: number; name: string; count: number }[];
  characters: { id: number; name: string; worldName: string; count: number }[];
}

const RANGES = [7, 30, 90];
const C_BLUE = "#2a78d6";
const C_ORANGE = "#eb6834";
const C_AQUA = "#1baf7a";
const PIE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const PIE_OTHER = "#898781";
const AXIS_TICK = { fill: "#898781", fontSize: 12 };
const AXIS_LINE = { stroke: "#c3c2b7" };
const GRID = "#e1e0d9";
const CHART_H = 280;

function NoData() {
  return <p className="muted" style={{ padding: "24px 0", textAlign: "center" }}>데이터 없음</p>;
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 160px", margin: 0 }}>
      <div style={{ fontSize: 30, fontWeight: 700 }}>{value.toLocaleString()}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      {note && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

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

interface CostData {
  month: string;
  providers: {
    id: number; name: string; model: string;
    inputTokens: number; outputTokens: number; requests: number; cost: number; currency: string;
  }[];
  imageCount: number;
  imageCost: number;
  imageCurrency: string;
  totals: Record<string, number>;
}

const money = (n: number, cur: string) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

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
  const [cost, setCost] = useState<CostData | null>(null);

  useEffect(() => {
    fetch("/api/stats/cost")
      .then((r) => r.json())
      .then(setCost)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/usage?days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [days]);

  const o = data?.overall;
  const [range, setRange] = useState(30);
  const [rankDays, setRankDays] = useState(30);
  const [daily, setDaily] = useState<DailyItem[] | null>(null);
  const [counts, setCounts] = useState<ContentCounts | null>(null);
  const [share, setShare] = useState<ShareData | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setMetricsLoading(true);
    Promise.all([
      fetch(`/api/stats/daily?days=${range}`).then((r) => r.json()).catch(() => null),
    ]).then(([d]) => {
      if (!alive) return;
      setDaily(d && Array.isArray(d.items) ? d.items : []);
      if (d?.counts) setCounts(d.counts);
      setMetricsLoading(false);
    });
    return () => { alive = false; };
  }, [range]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/stats/share?days=${rankDays}`)
      .then((r) => r.json())
      .catch(() => null)
      .then((s) => {
        if (!alive) return;
        setShare(s && Array.isArray(s.worlds) ? s : { total: 0, worlds: [], characters: [] });
      });
    return () => { alive = false; };
  }, [rankDays]);

  const [tab, setTab] = useState<Tab>("metrics");
  const [ccuHours, setCcuHours] = useState(48);
  const [ccu, setCcu] = useState<CcuItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/stats/ccu?hours=${ccuHours}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setCcu(d && Array.isArray(d.items) ? d.items : []); })
      .catch(() => { if (alive) setCcu([]); });
    return () => { alive = false; };
  }, [ccuHours]);

  const [rank, setRank] = useState<RankData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/stats/rankings?days=${rankDays}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setRank({
            topUsers: d?.topUsers ?? [],
            topCharacters: d?.topCharacters ?? [],
            topItems: d?.topItems ?? [],
            topGifted: d?.topGifted ?? [],
          });
        }
      })
      .catch(() => { if (alive) setRank({ topUsers: [], topCharacters: [], topItems: [], topGifted: [] }); });
    return () => { alive = false; };
  }, [rankDays]);

  // 판매지표 (코인 소비 기준)
  const [salesDays, setSalesDays] = useState(30);
  const [sales, setSales] = useState<SalesData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/stats/sales?days=${salesDays}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setSales(d && Array.isArray(d.items) ? d : null); })
      .catch(() => { if (alive) setSales(null); });
    return () => { alive = false; };
  }, [salesDays]);
  const hide = (t: Tab) => ({ display: tab === t ? "block" : "none" });

  const today = daily && daily.length > 0 ? daily[daily.length - 1] : null;

  const worldPie = useMemo(() => {
    if (!share) return [];
    const top = share.worlds.slice(0, 8).map((w, i) => ({ name: w.name, value: w.count, color: PIE_COLORS[i] }));
    const rest = share.worlds.slice(8).reduce((a, w) => a + w.count, 0);
    if (rest > 0) top.push({ name: "기타", value: rest, color: PIE_OTHER });
    return top;
  }, [share]);
  const worldTotal = worldPie.reduce((a, w) => a + w.value, 0);

  const charBars = useMemo(() => {
    if (!share) return [];
    return share.characters.slice(0, 10).map((c) => ({
      label: `${c.name}(${c.worldName})`,
      count: c.count,
      pct: share.total > 0 ? Math.round((c.count / share.total) * 1000) / 10 : 0,
    }));
  }, [share]);

  const llmBars = useMemo(
    () =>
      (cost?.providers ?? []).map((p) => ({
        name: p.name, inputTokens: p.inputTokens, outputTokens: p.outputTokens,
        cost: p.cost, currency: p.currency,
      })),
    [cost],
  );
  const llmHasData = llmBars.some((b) => b.inputTokens > 0 || b.outputTokens > 0);

  const dateTick = (d: string) => d.slice(5);

  return (
    <>
      <h2>서비스 지표</h2>
      <div className="tabs">
        <button type="button" className={`tab ${tab === "metrics" ? "active" : ""}`} onClick={() => setTab("metrics")}>지표</button>
        <button type="button" className={`tab ${tab === "sales" ? "active" : ""}`} onClick={() => setTab("sales")}>판매지표</button>
        <button type="button" className={`tab ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>AI</button>
        <button type="button" className={`tab ${tab === "rank" ? "active" : ""}`} onClick={() => setTab("rank")}>사용량 랭킹</button>
      </div>

      <div style={hide("sales")}>
      <div className="panel">
        <div style={{ display: "flex", gap: 8 }}>
          {SALES_RANGES.map((d) => (
            <button key={d} style={{ marginTop: 0, opacity: salesDays === d ? 1 : 0.5 }} onClick={() => setSalesDays(d)}>
              {d}일
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          코인 소비 기준 판매액입니다. 아이템 = 선물 사용, 채팅 = 메시지 과금, 지원 = AI 보조·이미지·영상 생성.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tile label={`아이템 판매액 (${salesDays}일)`} value={sales?.totals.gift ?? 0} />
        <Tile label={`채팅 판매액 (${salesDays}일)`} value={sales?.totals.chat ?? 0} />
        <Tile label={`지원 판매액 (${salesDays}일)`} value={sales?.totals.support ?? 0} />
        <Tile label={`합계 (${salesDays}일)`} value={sales?.totals.total ?? 0} />
      </div>

      <h3>일별 판매액</h3>
      <div className="panel">
        {sales && sales.items.some((i) => i.total > 0) ? (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <LineChart data={sales.items} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={dateTick} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip formatter={(v) => Number(v).toLocaleString()} />
              <Legend />
              <Line type="monotone" dataKey="gift" name="아이템" stroke={C_BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="chat" name="채팅" stroke={C_ORANGE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="support" name="지원" stroke={C_AQUA} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <NoData />
        )}
      </div>

      <h3>일별 판매액 테이블</h3>
      <div className="panel">
        <table>
          <thead>
            <tr><th>날짜</th><th>아이템</th><th>채팅</th><th>지원</th><th>합계</th></tr>
          </thead>
          <tbody>
            {(sales?.items ?? []).slice().reverse().map((i) => (
              <tr key={i.date}>
                <td>{i.date}</td>
                <td>{fmt(i.gift)}</td>
                <td>{fmt(i.chat)}</td>
                <td>{fmt(i.support)}</td>
                <td><b>{fmt(i.total)}</b></td>
              </tr>
            ))}
            {(!sales || sales.items.length === 0) && <tr><td colSpan={5} className="muted">데이터 없음</td></tr>}
          </tbody>
        </table>
      </div>
      </div>

      <div style={hide("metrics")}>
      <div className="panel">
        <div style={{ display: "flex", gap: 8 }}>
          {RANGES.map((d) => (
            <button
              key={d}
              style={{ marginTop: 0, opacity: range === d ? 1 : 0.5 }}
              onClick={() => setRange(d)}
            >
              {d}일
            </button>
          ))}
          {metricsLoading && <span className="muted" style={{ alignSelf: "center" }}>불러오는 중...</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tile label="오늘 DAU" value={today?.dau ?? 0} />
        <Tile label="오늘 신규(NU)" value={today?.nu ?? 0} />
        <Tile label="오늘 PU(코인 사용)" value={today?.pu ?? 0} note="결제 도입 전: 코인 소비 유저 기준" />
        <Tile label="오늘 메시지" value={today?.messages ?? 0} />
        <Tile label="세계관 수" value={counts?.worlds ?? 0} note={`공개 ${(counts?.worldsOpen ?? 0).toLocaleString()}개`} />
        <Tile label="캐릭터 수" value={counts?.characters ?? 0} note={`공개 ${(counts?.charactersOpen ?? 0).toLocaleString()}개`} />
      </div>

      <h3>일별 유저 지표</h3>
      <div className="panel">
        {daily && daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <LineChart data={daily} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={dateTick} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip formatter={(v) => Number(v).toLocaleString()} />
              <Legend />
              <Line type="monotone" dataKey="dau" name="DAU" stroke={C_BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="nu" name="NU" stroke={C_ORANGE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="pu" name="PU" stroke={C_AQUA} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <NoData />
        )}
      </div>

      <h3>시간대별 활성 유저 (CCU 근사)</h3>
      <div className="panel">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {CCU_RANGES.map((r) => (
            <button key={r.hours} style={{ marginTop: 0, opacity: ccuHours === r.hours ? 1 : 0.5 }} onClick={() => setCcuHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
        {ccu && ccu.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <AreaChart data={ccu} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(h: string) => h.slice(11)} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} minTickGap={24} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip labelFormatter={(l) => String(l)} formatter={(v) => [Number(v).toLocaleString(), "활성 유저"]} />
              <Area type="monotone" dataKey="users" name="활성 유저" stroke={C_BLUE} strokeWidth={2} fill={C_BLUE} fillOpacity={0.15} dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <NoData />
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>세션 추적 도입 전까지 &apos;그 시간에 메시지를 보낸 유저 수&apos; 기준</p>
      </div>

      <h3>일별 메시지 수</h3>
      <div className="panel">
        {daily && daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <BarChart data={daily} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={dateTick} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip formatter={(v) => Number(v).toLocaleString()} />
              <Bar dataKey="messages" name="메시지 수" fill={C_BLUE} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <NoData />
        )}
      </div>
      </div>

      <div style={hide("ai")}>
      <h3>LLM 사용량 (이번 달, 프로바이더별)</h3>
      <div className="panel">
        {llmHasData ? (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <BarChart data={llmBars} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0].payload as (typeof llmBars)[number];
                  return (
                    <div style={{ background: "#fff", border: "1px solid #e1e0d9", padding: "8px 12px", fontSize: 13, color: "#222" }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{String(label)}</div>
                      <div>입력 토큰: {row.inputTokens.toLocaleString()}</div>
                      <div>출력 토큰: {row.outputTokens.toLocaleString()}</div>
                      <div>예상 비용: {money(row.cost, row.currency)}</div>
                    </div>
                  );
                }}
              />
              <Legend />
              <Bar dataKey="inputTokens" name="입력 토큰" stackId="t" fill={C_BLUE} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="outputTokens" name="출력 토큰" stackId="t" fill={C_ORANGE} stroke="#fff" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <NoData />
        )}
      </div>

      <h3>이번 달 예상 AI 비용</h3>
      <div className="panel">
        {cost ? (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
              {Object.keys(cost.totals).length === 0
                ? "0.00"
                : Object.entries(cost.totals).map(([cur, n], i) => (
                    <span key={cur}>{i > 0 && " + "}{money(n, cur)}</span>
                  ))}
              <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 12 }}>
                {cost.month} (UTC)
              </span>
            </div>
            <table>
              <thead>
                <tr><th>이름</th><th>모델</th><th>요청수</th><th>입력 토큰</th><th>출력 토큰</th><th>예상 비용</th></tr>
              </thead>
              <tbody>
                {cost.providers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.model}</td>
                    <td>{fmt(p.requests)}</td>
                    <td>{fmt(p.inputTokens)}</td>
                    <td>{fmt(p.outputTokens)}</td>
                    <td>{money(p.cost, p.currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td>이미지 생성</td>
                  <td className="muted">기본 이미지 프로바이더</td>
                  <td>{fmt(cost.imageCount)}</td>
                  <td className="muted">-</td>
                  <td className="muted">-</td>
                  <td>{money(cost.imageCost, cost.imageCurrency)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8 }}>
              비용 집계는 이 기능 배포 이후 호출부터 쌓이며, 오늘부터 시작됩니다. 단가가 0이면 비용도 0으로 표시됩니다.
            </p>
          </>
        ) : (
          <p className="muted">불러오는 중...</p>
        )}
      </div>

      <h3>사용량 통계</h3>
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
      </div>

      <div style={hide("rank")}>
      <div className="panel">
        <div style={{ display: "flex", gap: 8 }}>
          {RANGES.map((d) => (
            <button key={d} style={{ marginTop: 0, opacity: rankDays === d ? 1 : 0.5 }} onClick={() => setRankDays(d)}>
              {d}일
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <h3>세계관 점유율</h3>
          <div className="panel">
            {worldPie.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <PieChart>
                  <Pie
                    data={worldPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {worldPie.map((w) => (
                      <Cell key={w.name} fill={w.color} stroke="#fff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => {
                      const val = Number(v);
                      const pct = worldTotal > 0 ? ((val / worldTotal) * 100).toFixed(1) : "0.0";
                      return [`${val.toLocaleString()}건 (${pct}%)`, String(n)];
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <NoData />
            )}
          </div>
        </div>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <h3>캐릭터 점유율 TOP 10</h3>
          <div className="panel">
            {charBars.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={charBars} layout="vertical" margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} tickFormatter={(v: number) => v.toLocaleString()} />
                  <YAxis type="category" dataKey="label" width={130} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} interval={0} />
                  <Tooltip
                    formatter={(v, _n, item) => [
                      `${Number(v).toLocaleString()}건 (${(item?.payload as { pct: number }).pct.toLocaleString()}%)`,
                      "메시지 수",
                    ]}
                  />
                  <Bar
                    dataKey="count"
                    name="메시지 수"
                    fill={C_BLUE}
                    radius={[0, 4, 4, 0]}
                    label={{
                      position: "right",
                      fill: "#222",
                      fontSize: 12,
                      formatter: (v: unknown) => {
                        const row = charBars.find((c) => c.count === Number(v));
                        return row ? `${row.pct.toLocaleString()}%` : "";
                      },
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoData />
            )}
          </div>
        </div>
      </div>

      <h3>대화 많이 한 유저 TOP 20</h3>
      <div className="panel">
        {rank && rank.topUsers.length > 0 ? (
          <table>
            <thead><tr><th>순위</th><th>유저</th><th>메시지 수</th></tr></thead>
            <tbody>
              {rank.topUsers.map((u, i) => (
                <tr key={u.id}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/users/${u.id}`} title={u.nickname ?? undefined}>
                      {u.vfunUserId ?? u.nickname ?? `#${u.id}`}{u.uNo != null ? `, no.${u.uNo}` : ""}
                    </Link>
                  </td>
                  <td>{fmt(u.messages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoData />
        )}
      </div>

      <h3>대화 많이 받은 캐릭터 TOP 20</h3>
      <div className="panel">
        {rank && rank.topCharacters.length > 0 ? (
          <table>
            <thead><tr><th>순위</th><th>캐릭터</th><th>메시지 수</th><th>대화 유저 수</th></tr></thead>
            <tbody>
              {rank.topCharacters.map((c, i) => (
                <tr key={c.id}>
                  <td>{i + 1}</td>
                  <td><Link href={`/characters/${c.id}`}>{c.name} ({c.worldName})</Link></td>
                  <td>{fmt(c.messages)}</td>
                  <td>{fmt(c.users)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoData />
        )}
      </div>

      <h3>아이템 판매량 랭킹 TOP 20</h3>
      <div className="panel">
        {rank && rank.topItems.length > 0 ? (
          <table>
            <thead><tr><th>순위</th><th>아이템</th><th>세계관</th><th>판매수</th><th>판매액</th></tr></thead>
            <tbody>
              {rank.topItems.map((it, i) => (
                <tr key={`${it.name}-${it.worldName}`}>
                  <td>{i + 1}</td>
                  <td>{it.name}</td>
                  <td>{it.worldName}</td>
                  <td>{fmt(it.count)}</td>
                  <td>{fmt(it.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoData />
        )}
      </div>

      <h3>선물 받은 캐릭터 랭킹 TOP 20</h3>
      <div className="panel">
        {rank && rank.topGifted.length > 0 ? (
          <table>
            <thead><tr><th>순위</th><th>캐릭터</th><th>선물 수</th><th>선물 금액</th><th>선물한 유저 수</th></tr></thead>
            <tbody>
              {rank.topGifted.map((c, i) => (
                <tr key={c.id}>
                  <td>{i + 1}</td>
                  <td><Link href={`/characters/${c.id}`}>{c.name} ({c.worldName})</Link></td>
                  <td>{fmt(c.count)}</td>
                  <td>{fmt(c.amount)}</td>
                  <td>{fmt(c.users)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <NoData />
        )}
      </div>
      </div>
    </>
  );
}
