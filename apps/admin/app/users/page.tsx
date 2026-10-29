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

  useEffect(() => {
    fetch(`/api/users?q=${encodeURIComponent(debounced)}&offset=${offset}&limit=${PAGE}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setTotal(d.total ?? 0);
      });
  }, [debounced, offset]);

  return (
    <>
      <h2>유저 관리</h2>
      <div className="panel">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="닉네임 / username / vfun ID 검색"
        />
        <table>
          <thead>
            <tr><th>ID</th><th>닉네임</th><th>vfun ID</th><th>등급</th><th>잔액</th><th>상태</th><th>가입일</th></tr>
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
                <td className="muted">{new Date(u.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="muted">유저가 없습니다.</td></tr>
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
