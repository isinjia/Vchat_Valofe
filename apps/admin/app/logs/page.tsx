"use client";

import { Fragment, useEffect, useState } from "react";

interface LogItem {
  id: number;
  admin_user_id: number;
  method: string;
  path: string;
  detail: string | null;
  created_at: string;
  vfun_user_id: string | null;
  vfun_u_no: number | null;
  nickname: string;
}
interface AdminOpt {
  id: number;
  vfun_user_id: string | null;
  vfun_u_no: number | null;
}

const PAGE = 50;
const who = (a: { id: number; vfun_user_id: string | null; vfun_u_no: number | null }) =>
  `${a.vfun_user_id ?? `#${a.id}`} (no.${a.vfun_u_no ?? "-"})`;

export default function LogsPage() {
  const [admins, setAdmins] = useState<AdminOpt[]>([]);
  const [adminId, setAdminId] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/logs?distinctAdmins=1")
      .then((r) => r.json())
      .then((d) => setAdmins(d.admins ?? []))
      .catch(() => {});
  }, []);

  // 경로 검색 디바운스
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const sp = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (adminId) sp.set("adminId", adminId);
    if (q) sp.set("q", q);
    fetch(`/api/logs?${sp}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "조회 실패");
        return r.json();
      })
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
        setOpen(null);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  }, [adminId, q, offset]);

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <h2>관리자 로그</h2>
      <div className="panel">
        <div className="row">
          <div>
            <label>관리자</label>
            <select
              value={adminId}
              onChange={(e) => {
                setAdminId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">전체</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>{who(a)}</option>
              ))}
            </select>
          </div>
          <div>
            <label>경로 검색</label>
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="/api/users ..." />
          </div>
        </div>
      </div>

      <div className="panel">
        {err && <p className="muted">{err}</p>}
        <table>
          <thead>
            <tr><th>시각</th><th>관리자</th><th>메서드</th><th>경로</th><th>내용</th></tr>
          </thead>
          <tbody>
            {items.map((l) => {
              const detail = l.detail ?? "";
              const expanded = open === l.id;
              return (
                <Fragment key={l.id}>
                  <tr
                    onClick={() => detail && setOpen(expanded ? null : l.id)}
                    style={{ cursor: detail ? "pointer" : "default" }}
                  >
                    <td className="muted">{new Date(l.created_at).toLocaleString("ko-KR")}</td>
                    <td title={l.nickname}>{who({ id: l.admin_user_id, vfun_user_id: l.vfun_user_id, vfun_u_no: l.vfun_u_no })}</td>
                    <td>{l.method}</td>
                    <td>{l.path}</td>
                    <td className="muted">
                      {detail.length > 120 ? detail.slice(0, 120) + "…" : detail || "-"}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={5}>
                        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{detail}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {items.length === 0 && !err && (
              <tr><td colSpan={5} className="muted">로그가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>이전</button>
          <span className="muted">{page} / {pages} 페이지 (총 {total.toLocaleString()}건)</span>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>다음</button>
        </div>
      </div>
    </>
  );
}
