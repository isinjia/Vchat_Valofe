"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface WorldRow {
  id: number;
  name: string;
  description: string;
  is_active: number;
  character_count: number;
  owner_user_id: number | null;
  owner_nickname: string | null;
  /** vfun 닉네임은 바뀔 수 있어 표시에는 user id / no 를 쓴다 */
  owner_vfun_id: string | null;
  owner_u_no: number | null;
  delete_scheduled_at?: string | null;
}

const fmtDt = (x: string) =>
  new Date(x).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<WorldRow[]>([]);
  const [name, setName] = useState("");

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [visibility, setVisibility] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState("");
  const PAGE_SIZE = 20;
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // 검색어 디바운스 300ms (검색 변경 시 첫 페이지로)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  /** 필터 select 변경: 값 반영 + 첫 페이지로 */
  const onFilter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value);
    setOffset(0);
  };

  const load = () => {
    const sp = new URLSearchParams();
    if (debounced) sp.set("q", debounced);
    if (visibility) sp.set("visibility", visibility);
    if (status) sp.set("status", status);
    if (owner) sp.set("owner", owner);
    if (state) sp.set("state", state);
    sp.set("limit", String(PAGE_SIZE));
    sp.set("offset", String(offset));
    return fetch(`/api/worlds?${sp.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setWorlds(d.items ?? []);
        setTotal(Number(d.total) || 0);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, visibility, status, owner, state, offset]);

  const create = async () => {
    if (!name.trim()) return;
    await fetch("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setName("");
    load();
  };

  // JSON 가져오기: 파일 선택 → POST → 성공 시 편집 페이지로 이동
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const data = JSON.parse(await file.text());
      const res = await fetch("/api/worlds/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(r.error ?? "가져오기 실패");
        return;
      }
      if (r.warnings?.length) alert(`가져오기 완료 (경고 ${r.warnings.length}건)\n` + r.warnings.slice(0, 20).join("\n"));
      window.location.href = `/worlds/${r.id}`;
    } catch {
      alert("올바른 JSON 파일이 아닙니다.");
    } finally {
      setImporting(false);
    }
  };

  const remove = async (w: WorldRow) => {
    const input = prompt("삭제하려면 세계관 이름을 똑같이 입력하세요: " + w.name);
    if (input === null) return;
    const res = await fetch(`/api/worlds/${w.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(r.error ?? "삭제 실패");
      return;
    }
    alert("3일 후 삭제됩니다. 그 전까지 취소할 수 있습니다.");
    load();
  };

  const cancelRemove = async (id: number) => {
    const res = await fetch(`/api/worlds/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel: true }),
    });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(r.error ?? "삭제 취소 실패");
    }
    load();
  };

  return (
    <>
      <h2>세계관 관리</h2>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      <div style={{ marginBottom: 12 }}>
        <button className="small" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? "가져오는 중..." : "JSON 가져오기"}
        </button>
      </div>
      <div className="panel">
        <label>새 세계관 이름</label>
        <div className="row">
          <div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 아르카디아 대륙" />
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <button style={{ marginTop: 0 }} onClick={create}>추가</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 2 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="세계관 이름 검색" />
          </div>
          <div>
            <select value={visibility} onChange={onFilter(setVisibility)}>
              <option value="">공개여부: 전체</option>
              <option value="open">공개</option>
              <option value="private">비공개</option>
            </select>
          </div>
          <div>
            <select value={status} onChange={onFilter(setStatus)}>
              <option value="">상태: 전체</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </div>
          <div>
            <select value={owner} onChange={onFilter(setOwner)}>
              <option value="">소유: 전체</option>
              <option value="admin">운영 (owner NULL)</option>
              <option value="user">유저 제작</option>
            </select>
          </div>
          <div>
            <select value={state} onChange={onFilter(setState)}>
              <option value="">삭제 대기: 전체</option>
              <option value="delete_pending">삭제 대기만</option>
            </select>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>이름</th><th>설명</th><th>제작자</th><th>캐릭터 수</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {worlds.map((w) => (
              <tr key={w.id}>
                <td>{w.id}</td>
                <td><Link href={`/worlds/${w.id}`}>{w.name}</Link></td>
                <td className="muted">{w.description.slice(0, 60)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {w.owner_user_id ? (
                    <Link href={`/users/${w.owner_user_id}`} title={`유저 관리에서 보기 (닉네임: ${w.owner_nickname ?? "-"})`}>
                      {w.owner_vfun_id ?? w.owner_nickname ?? "유저"}{" "}
                      <span className="muted">no.{w.owner_u_no ?? w.owner_user_id}</span>
                    </Link>
                  ) : (
                    <span className="muted">운영</span>
                  )}
                </td>
                <td>{w.character_count}</td>
                <td style={{ whiteSpace: "nowrap" }}>{w.is_active ? "활성" : "비활성"}
                  {w.delete_scheduled_at && (
                    <div style={{ color: "#e5484d" }}>🗑 삭제 대기(~{fmtDt(w.delete_scheduled_at)})</div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {/* 내보내기는 세계관 상세(편집) 페이지로 이동 */}
                  {w.delete_scheduled_at ? (
                    <button className="small" onClick={() => cancelRemove(w.id)}>삭제 취소</button>
                  ) : (
                    <button className="danger small" onClick={() => remove(w)}>삭제</button>
                  )}
                </td>
              </tr>
            ))}
            {worlds.length === 0 && (
              <tr><td colSpan={7} className="muted">등록된 세계관이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        <div className="pager">
          <button className="small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            이전
          </button>
          <span>
            {total === 0 ? 0 : Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 페이지 (총 {total.toLocaleString()}건)
          </span>
          <button className="small" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            다음
          </button>
        </div>
      </div>
    </>
  );
}
