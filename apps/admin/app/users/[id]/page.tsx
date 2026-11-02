"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import SanctionPanel from "../../components/SanctionPanel";

interface Detail {
  user: {
    id: number;
    username: string;
    nickname: string;
    vfun_user_id: string | null;
    coins: number;
    status: "active" | "banned";
    admin_role: "user_admin" | "system_admin" | null;
    tier_id: number | null;
    creator_tier_id: number | null;
    ai_level_id: number | null;
    created_at: string;
  };
  coinSummary: { type: string; count: number; total: number }[];
  recentTransactions: {
    id: number;
    type: string;
    amount: number;
    balance_after: number;
    created_at: string;
  }[];
  characters: {
    characterId: number;
    characterName: string;
    worldName: string | null;
    affinity: number;
    message_count: number;
    totalIn: number;
    totalOut: number;
    updated_at: string;
  }[];
}

const TYPE_LABEL: Record<string, string> = {
  auto_topup: "자동지급",
  chat_spend: "채팅 사용",
  ai_assist_spend: "AI 보조",
  illust_gen_spend: "일러스트 생성",
  video_gen_spend: "영상 생성",
  gift_spend: "선물 아이템 사용",
  chat_fee_income: "채팅 수수료 수입",
  gift_fee_income: "선물 수수료 수입",
  world_fee_income: "세계관 수수료 수입",
};

const fmt = (n: number) => Number(n).toLocaleString();
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [tiers, setTiers] = useState<{ id: number; name: string; track: string }[]>([]);
  const [aiLevels, setAiLevels] = useState<{ id: number; level: number; name: string }[]>([]);
  const [err, setErr] = useState("");
  // 아이템 사용 내역 (선물)
  const [itemUses, setItemUses] = useState<{
    recent: { id: number; item_name: string; price: number; affinity_applied: number; created_at: string; character_name: string | null; world_name: string | null }[];
    summary: { item_name: string; cnt: number; total: number }[];
  } | null>(null);

  const load = () =>
    fetch(`/api/users/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "조회 실패");
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    fetch("/api/tiers").then((r) => r.json()).then(setTiers);
    fetch("/api/ai-levels").then((r) => r.json()).then(setAiLevels);
    fetch(`/api/users/${id}/item-uses`)
      .then((r) => r.json())
      .then((d) => setItemUses(d.error ? null : d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const update = async (body: object) => {
    const r = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) alert((await r.json()).error ?? "변경 실패");
    load();
  };

  const toggleStatus = () => {
    if (!data) return;
    if (data.user.status === "active") {
      if (!confirm("이 유저를 정지하시겠습니까? 채팅이 차단됩니다.")) return;
      update({ status: "banned" });
    } else {
      update({ status: "active" });
    }
  };

  if (err) return <p className="muted">{err}</p>;
  if (!data) return <p className="muted">불러오는 중...</p>;
  const { user, coinSummary, recentTransactions, characters } = data;

  return (
    <>
      <h2>
        <Link href="/users">←</Link> {user.nickname} <span className="muted">(#{user.id})</span>{" "}
        {user.status === "banned" && <span className="badge banned">정지</span>}
      </h2>

      <div className="panel">
        <div className="row">
          <div><label>vfun ID</label><div>{user.vfun_user_id ?? "-"}</div></div>
          <div><label>가입일</label><div>{new Date(user.created_at).toLocaleString()}</div></div>
          <div><label>잔액</label><div>{fmt(user.coins)}</div></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <label>채팅 등급</label>
            <select
              value={user.tier_id ?? ""}
              onChange={(e) => update({ tier_id: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">기본 등급</option>
              {tiers.filter((t) => t.track === "user").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label>크리에이터 등급</label>
            <select
              value={user.creator_tier_id ?? ""}
              onChange={(e) => update({ creator_tier_id: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">없음</option>
              {tiers.filter((t) => t.track === "creator").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label>AI 레벨</label>
            <select
              value={user.ai_level_id ?? ""}
              onChange={(e) => update({ ai_level_id: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">선택 안 함(기본)</option>
              {aiLevels.map((l) => <option key={l.id} value={l.id}>Lv.{l.level} {l.name}</option>)}
            </select>
          </div>
          <div>
            <label>관리자 권한</label>
            <select
              value={user.admin_role ?? ""}
              onChange={(e) => update({ admin_role: e.target.value === "" ? null : e.target.value })}
            >
              <option value="">없음</option>
              <option value="user_admin">유저 관리자</option>
              <option value="system_admin">시스템 관리자</option>
            </select>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              권한 변경은 해당 관리자가 다시 로그인해야 반영됩니다.
            </div>
          </div>
          <div>
            <label>상태</label>
            <button
              className={user.status === "active" ? "danger" : ""}
              style={{ marginTop: 0 }}
              onClick={toggleStatus}
            >
              {user.status === "active" ? "정지하기" : "정지 해제"}
            </button>
          </div>
        </div>
      </div>

      <SanctionPanel targetType="user" targetId={id} />

      <div className="panel">
        <h3>코인 사용 요약</h3>
        <table>
          <thead><tr><th>종류</th><th>건수</th><th>합계</th></tr></thead>
          <tbody>
            {coinSummary.map((s) => (
              <tr key={s.type}>
                <td>{TYPE_LABEL[s.type] ?? s.type}</td>
                <td>{fmt(s.count)}</td>
                <td>{signed(s.total)}</td>
              </tr>
            ))}
            {coinSummary.length === 0 && <tr><td colSpan={3} className="muted">코인 거래 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>최근 거래 30건</h3>
        <table>
          <thead><tr><th>일시</th><th>종류</th><th>증감</th><th>잔액</th></tr></thead>
          <tbody>
            {recentTransactions.map((t) => (
              <tr key={t.id}>
                <td className="muted">{new Date(t.created_at).toLocaleString()}</td>
                <td>{TYPE_LABEL[t.type] ?? t.type}</td>
                <td>{signed(t.amount)}</td>
                <td>{fmt(t.balance_after)}</td>
              </tr>
            ))}
            {recentTransactions.length === 0 && <tr><td colSpan={4} className="muted">거래 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <label>아이템 사용 정보 (선물)</label>
        <table>
          <thead><tr><th>아이템</th><th>사용 수</th><th>사용 금액</th></tr></thead>
          <tbody>
            {(itemUses?.summary ?? []).map((s) => (
              <tr key={s.item_name}>
                <td>{s.item_name}</td>
                <td>{fmt(Number(s.cnt))}</td>
                <td>{fmt(Number(s.total))}</td>
              </tr>
            ))}
            {(!itemUses || itemUses.summary.length === 0) && (
              <tr><td colSpan={3} className="muted">아이템 사용 내역이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        {itemUses && itemUses.recent.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>최근 사용 내역 (100건)</label>
            <table>
              <thead><tr><th>일시</th><th>아이템</th><th>대상 캐릭터</th><th>가격</th><th>호감도 적용</th></tr></thead>
              <tbody>
                {itemUses.recent.map((u) => (
                  <tr key={u.id}>
                    <td className="muted">{new Date(u.created_at).toLocaleString()}</td>
                    <td>{u.item_name}</td>
                    <td>{u.character_name ?? "-"}{u.world_name ? ` (${u.world_name})` : ""}</td>
                    <td>{fmt(Number(u.price))}</td>
                    <td>{signed(Number(u.affinity_applied))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="panel">
        <h3>채팅한 캐릭터</h3>
        <table>
          <thead><tr><th>캐릭터 (세계관)</th><th>호감도</th><th>대화수</th><th>입력/출력 토큰</th><th>마지막 상호작용</th></tr></thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.characterId}>
                <td>
                  <Link href={`/characters/${c.characterId}`}>{c.characterName}</Link>{" "}
                  <span className="muted">({c.worldName ?? "-"})</span>
                </td>
                <td>♥ {c.affinity}</td>
                <td>{fmt(c.message_count)}</td>
                <td>{fmt(c.totalIn)} / {fmt(c.totalOut)}</td>
                <td className="muted">{new Date(c.updated_at).toLocaleString()}</td>
              </tr>
            ))}
            {characters.length === 0 && <tr><td colSpan={5} className="muted">채팅한 캐릭터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
