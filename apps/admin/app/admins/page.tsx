"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Role = "user_admin" | "system_admin";

interface Admin {
  id: number;
  vfun_user_id: string | null;
  vfun_u_no: number | null;
  nickname: string;
  admin_role: Role;
  block_count: number;
  active_block: { id: number; ends_at: string; reason: string | null } | null;
}

const ROLE_LABEL: Record<Role, string> = {
  user_admin: "유저 관리자",
  system_admin: "시스템 관리자",
};

const fmt = (s: string) => new Date(s).toLocaleString("ko-KR");

export default function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [me, setMe] = useState<number | null>(null);
  const [vfunUserId, setVfunUserId] = useState("");
  const [role, setRole] = useState<Role>("user_admin");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await fetch("/api/admins");
    if (!r.ok) return;
    const d = await r.json();
    setAdmins(d.admins);
    setMe(d.me);
  };
  useEffect(() => {
    load();
  }, []);

  const call = async (url: string, method: string, body?: unknown): Promise<boolean> => {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(e.error ?? "요청 실패");
    }
    await load();
    return r.ok;
  };

  const add = async () => {
    if (!vfunUserId.trim()) return;
    const r = await fetch("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vfunUserId: vfunUserId.trim(), role }),
    });
    if (r.ok) {
      setMsg({ ok: true, text: `${vfunUserId.trim()} 를 ${ROLE_LABEL[role]}로 지정했습니다.` });
      setVfunUserId("");
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      setMsg({ ok: false, text: e.error ?? "추가 실패" });
    }
  };

  const suspend = async (a: Admin) => {
    const d = prompt("정지 일수 (1~365)", "3");
    if (d === null) return;
    const days = Number(d);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      alert("일수는 1~365 사이 정수여야 합니다.");
      return;
    }
    const reason = prompt("정지 사유 (선택)", "") ?? "";
    await call("/api/sanctions", "POST", {
      target_type: "user",
      target_id: a.id,
      kind: "admin_block",
      days,
      reason: reason.trim() || undefined,
    });
  };

  const label = (a: Admin) => `${a.vfun_user_id ?? "-"}${a.vfun_u_no != null ? `, no.${a.vfun_u_no}` : ""}`;

  return (
    <>
      <h2>관리자 관리</h2>
      <p className="muted">
        권한 변경·정지는 해당 관리자의 다음 로그인부터 적용됩니다 (기존 세션은 최대 12시간 유지).
      </p>

      <h3>관리자 추가</h3>
      <div className="panel">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2 }}>
            <label>vfun 아이디</label>
            <input type="text" value={vfunUserId} onChange={(e) => setVfunUserId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
          </div>
          <div style={{ flex: 1 }}>
            <label>등급</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user_admin">유저 관리자</option>
              <option value="system_admin">시스템 관리자</option>
            </select>
          </div>
          <div>
            <button onClick={add}>관리자 추가</button>
          </div>
        </div>
        {msg && (
          <p style={{ marginTop: 8, color: msg.ok ? "#30a46c" : "#e5484d" }}>{msg.text}</p>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          서비스 또는 관리툴에 vfun 로그인한 적 있는 계정만 지정할 수 있습니다.
        </p>
      </div>

      <h3 style={{ marginTop: 24 }}>관리자 목록 ({admins.length})</h3>
      <table>
        <thead>
          <tr>
            <th>관리자</th>
            <th>등급</th>
            <th>정지 상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {admins.length === 0 && (
            <tr><td colSpan={4} className="muted">관리자가 없습니다.</td></tr>
          )}
          {admins.map((a) => {
            const self = a.id === me;
            return (
              <tr key={a.id}>
                <td>
                  <Link href={`/users/${a.id}`} title={a.nickname}>{label(a)}</Link>
                  {self && <> <span className="badge">본인</span></>}
                </td>
                <td>
                  <select value={a.admin_role} disabled={self}
                    onChange={(e) => call(`/api/admins/${a.id}`, "PUT", { role: e.target.value })}>
                    <option value="user_admin">유저 관리자</option>
                    <option value="system_admin">시스템 관리자</option>
                  </select>
                </td>
                <td>
                  {a.active_block ? (
                    <span style={{ color: "#e5484d" }}>
                      {fmt(a.active_block.ends_at)}까지{a.active_block.reason ? ` (${a.active_block.reason})` : ""}
                    </span>
                  ) : (
                    "-"
                  )}
                  <span className="muted"> · 누적 {a.block_count}회</span>
                </td>
                <td>
                  {!self && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {a.active_block ? (
                        <button className="small"
                          onClick={() => call(`/api/sanctions/${a.active_block!.id}`, "DELETE")}>
                          정지 해제
                        </button>
                      ) : (
                        <button className="small" onClick={() => suspend(a)}>일시 정지</button>
                      )}
                      <button className="small danger"
                        onClick={() => {
                          if (confirm(`${label(a)} 를 관리자에서 제외할까요?`))
                            call(`/api/admins/${a.id}`, "DELETE");
                        }}>
                        관리자 제외
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
