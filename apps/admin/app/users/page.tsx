"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UserRow {
  id: number;
  username: string;
  nickname: string;
  vfun_user_id: string | null;
  coins: number;
  status: "active" | "banned";
  tier_id: number | null;
  tier_name: string | null;
  created_at: string;
  /** 누적 제재 횟수 / 현재 활성 제재 수 */
  sanction_count: number;
  active_sanction_count: number;
}

interface TierOpt {
  id: number;
  name: string;
  track: "user" | "creator";
}

const PAGE = 20;

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);

  // 검색어 디바운스 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const [status, setStatus] = useState("");
  const [tierId, setTierId] = useState("");
  const [creatorTierId, setCreatorTierId] = useState("");
  const [sanction, setSanction] = useState("");
  const [tiers, setTiers] = useState<TierOpt[]>([]);

  useEffect(() => {
    fetch("/api/tiers").then((r) => r.json()).then((d) => setTiers(Array.isArray(d) ? d : []));
  }, []);

  const filterQuery = () => {
    const sp = new URLSearchParams();
    if (debounced) sp.set("q", debounced);
    if (status) sp.set("status", status);
    if (tierId) sp.set("tierId", tierId);
    if (creatorTierId) sp.set("creatorTierId", creatorTierId);
    if (sanction) sp.set("sanction", sanction);
    return sp;
  };

  useEffect(() => {
    const sp = filterQuery();
    sp.set("offset", String(offset));
    sp.set("limit", String(PAGE));
    fetch(`/api/users?${sp.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setTotal(d.total ?? 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, status, tierId, creatorTierId, sanction, offset]);

  const onFilter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value);
    setOffset(0);
  };

  return (
    <>
      <h2>유저 관리</h2>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 2 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="닉네임 / username / vfun ID 검색"
            />
          </div>
          <div>
            <select value={status} onChange={onFilter(setStatus)}>
              <option value="">상태: 전체</option>
              <option value="active">active</option>
              <option value="banned">banned</option>
            </select>
          </div>
          <div>
            <select value={tierId} onChange={onFilter(setTierId)}>
              <option value="">유저 등급: 전체</option>
              {tiers.filter((t) => t.track === "user").map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <select value={creatorTierId} onChange={onFilter(setCreatorTierId)}>
              <option value="">크리에이터 등급: 전체</option>
              <option value="none">없음</option>
              {tiers.filter((t) => t.track === "creator").map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <select value={sanction} onChange={onFilter(setSanction)}>
              <option value="">제재: 전체</option>
              <option value="active">제재 중</option>
            </select>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <a href={`/api/users/export?${filterQuery().toString()}`} download>
              <button type="button" className="small" style={{ marginTop: 0 }}>CSV 내보내기</button>
            </a>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>닉네임</th><th>vfun ID</th><th>등급</th><th>잔액</th><th>상태</th><th>제재</th><th>가입일</th></tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><Link href={`/users/${u.id}`}>{u.nickname}</Link></td>
                <td className="muted">{u.vfun_user_id ?? "-"}</td>
                <td>{u.tier_name ?? <span className="muted">기본</span>}</td>
                <td>{Number(u.coins).toLocaleString()}</td>
                <td>{u.status === "banned" ? <span className="badge banned">정지</span> : "활성"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {Number(u.sanction_count) > 0 ? (
                    <span
                      className={Number(u.active_sanction_count) > 0 ? "badge banned" : "muted"}
                      title={`누적 제재 ${u.sanction_count}회${Number(u.active_sanction_count) > 0 ? ` · 현재 제재 중 ${u.active_sanction_count}건` : ""}`}
                    >
                      {Number(u.active_sanction_count) > 0 ? "제재 중 · " : ""}누적 {u.sanction_count}회
                    </span>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td className="muted">{new Date(u.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="muted">유저가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        <div className="pager">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
          <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
          <button className="btn-secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>다음</button>
        </div>
      </div>
    </>
  );
}
