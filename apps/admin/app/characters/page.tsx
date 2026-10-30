"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface CharacterRow {
  id: number;
  name: string;
  world_id: number;
  world_name: string;
  is_active: number;
  like_count: number;
  chat_count: number;
  /** 대화한 유저 수 (user_character_state 기준) */
  user_count: number;
  owner_user_id: number | null;
  owner_nickname: string | null;
  /** vfun 닉네임은 바뀔 수 있어 표시에는 user id / no 를 쓴다 */
  owner_vfun_id: string | null;
  owner_u_no: number | null;
  delete_scheduled_at?: string | null;
}

const fmtDt = (x: string) =>
  new Date(x).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

interface WorldOption { id: number; name: string; }

export default function CharactersPage() {
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [name, setName] = useState("");
  const [worldId, setWorldId] = useState<number | "">("");

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fWorld, setFWorld] = useState("");
  const [visibility, setVisibility] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState("");
  const PAGE_SIZE = 20;
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // 쿼리 프리필: 세계관 인명사전의 '캐릭터 만들기' 등에서 ?worldId=&name= 으로 진입
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const preName = sp.get("name");
    if (preName) setName(preName);
    const preWorldId = Number(sp.get("worldId"));
    if (Number.isInteger(preWorldId) && preWorldId > 0) setWorldId(preWorldId);
  }, []);

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
    if (fWorld) sp.set("worldId", fWorld);
    if (visibility) sp.set("visibility", visibility);
    if (status) sp.set("status", status);
    if (owner) sp.set("owner", owner);
    if (state) sp.set("state", state);
    sp.set("limit", String(PAGE_SIZE));
    sp.set("offset", String(offset));
    return fetch(`/api/characters?${sp.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setCharacters(d.items ?? []);
        setTotal(Number(d.total) || 0);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, fWorld, visibility, status, owner, state, offset]);

  useEffect(() => {
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);
  }, []);

  const create = async () => {
    if (!name.trim() || !worldId) {
      alert("세계관과 이름을 입력하세요.");
      return;
    }
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ world_id: worldId, name: name.trim() }),
    });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(r.error ?? "생성 실패");
      return;
    }
    setName("");
    load();
  };

  // JSON 가져오기: 파일 선택 → 대상 세계관 확인 → POST
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileName: string; data: unknown } | null>(null);
  const [importWorldId, setImportWorldId] = useState<number | "">("");
  const [importing, setImporting] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setPending({ fileName: file.name, data: JSON.parse(await file.text()) });
    } catch {
      alert("올바른 JSON 파일이 아닙니다.");
    }
  };
  const doImport = async () => {
    if (!pending || !importWorldId) {
      alert("대상 세계관을 선택하세요.");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId: importWorldId, data: pending.data }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(r.error ?? "가져오기 실패");
        return;
      }
      if (r.warnings?.length) alert(`가져오기 완료 (경고 ${r.warnings.length}건)\n` + r.warnings.slice(0, 20).join("\n"));
      window.location.href = `/characters/${r.id}`;
    } finally {
      setImporting(false);
    }
  };

  const remove = async (c: CharacterRow) => {
    const input = prompt("삭제하려면 캐릭터 이름을 똑같이 입력하세요: " + c.name);
    if (input === null) return;
    const res = await fetch(`/api/characters/${c.id}`, {
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
    const res = await fetch(`/api/characters/${id}`, {
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
      <h2>캐릭터 관리</h2>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      <div className="panel">
        <button className="small" onClick={() => fileRef.current?.click()}>JSON 가져오기</button>
        {pending && (
          <div className="row" style={{ marginTop: 8 }}>
            <div>
              <label>대상 세계관 ({pending.fileName})</label>
              <select value={importWorldId} onChange={(e) => setImportWorldId(Number(e.target.value) || "")}>
                <option value="">선택...</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
              <button style={{ marginTop: 0 }} disabled={importing} onClick={doImport}>{importing ? "가져오는 중..." : "가져오기"}</button>{" "}
              <button className="ghost" style={{ marginTop: 0 }} onClick={() => setPending(null)}>취소</button>
            </div>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="row">
          <div>
            <label>세계관</label>
            <select value={worldId} onChange={(e) => setWorldId(Number(e.target.value) || "")}>
              <option value="">선택...</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>새 캐릭터 이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button style={{ marginTop: 0 }} onClick={create}>추가</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 2 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="캐릭터 이름 검색" />
          </div>
          <div>
            <select value={fWorld} onChange={onFilter(setFWorld)}>
              <option value="">세계관: 전체</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
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
              <option value="">제재/삭제: 전체</option>
              <option value="sanctioned">제재 중</option>
              <option value="delete_pending">삭제 대기</option>
            </select>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>이름</th><th>세계관</th><th>제작자</th><th>좋아요</th><th>대화 유저</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td><Link href={`/characters/${c.id}`}>{c.name}</Link></td>
                <td>{c.world_name}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.owner_user_id ? (
                    <Link href={`/users/${c.owner_user_id}`} title={`유저 관리에서 보기 (닉네임: ${c.owner_nickname ?? "-"})`}>
                      {c.owner_vfun_id ?? c.owner_nickname ?? "유저"}{" "}
                      <span className="muted">no.{c.owner_u_no ?? c.owner_user_id}</span>
                    </Link>
                  ) : (
                    <span className="muted">운영</span>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>❤️ {Number(c.like_count ?? 0).toLocaleString()}</td>
                <td style={{ whiteSpace: "nowrap" }} title={`누적 대화 ${Number(c.chat_count ?? 0).toLocaleString()}회`}>
                  👥 {Number(c.user_count ?? 0).toLocaleString()}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{c.is_active ? "활성" : "비활성"}
                  {c.delete_scheduled_at && (
                    <div style={{ color: "#e5484d" }}>🗑 삭제 대기(~{fmtDt(c.delete_scheduled_at)})</div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.delete_scheduled_at ? (
                    <button className="small" onClick={() => cancelRemove(c.id)}>삭제 취소</button>
                  ) : (
                    <button className="danger small" onClick={() => remove(c)}>삭제</button>
                  )}
                </td>
              </tr>
            ))}
            {characters.length === 0 && (
              <tr><td colSpan={8} className="muted">등록된 캐릭터가 없습니다.</td></tr>
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
