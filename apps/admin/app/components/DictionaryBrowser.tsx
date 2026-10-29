"use client";

import { useEffect, useRef, useState } from "react";

/** 사전 목록 항목 (GET 응답 items) */
export interface DictBrowserEntry {
  id: number;
  title: string;
  aliases: string | null;
  content: string;
  has_embedding?: number;
  linked_character_id?: number | null;
}

interface Props {
  /** GET 대상 (예: /api/worlds/2/dictionary) */
  baseUrl: string;
  /** 고정 분류 — 검색/자동완성/페이징 모두 이 분류만 대상 */
  category: "location" | "person" | "term";
  /** 섹션 제목 (건수는 컴포넌트가 붙임) */
  title: string;
  /** 지정 시 그 캐릭터 전용 사전, 생략 시 공용 */
  characterId?: number;
  /** 부모가 항목 추가/일괄 등록 등을 마친 뒤 값을 올리면 현재 검색 상태 그대로 재조회 */
  refreshKey?: number;
  /** 삭제 처리 (확인창 포함). false 반환 시 취소로 간주 */
  onDelete: (id: number) => Promise<boolean | void>;
  showEmbedding?: boolean;
  /** 인명사전 행의 연결 캐릭터 select (둘 다 있을 때만 표시) */
  linkChars?: { id: number; name: string }[];
  onLink?: (id: number, value: string) => Promise<void>;
}

const LIMIT = 20;
const CONTENT_MAX = 120;

export default function DictionaryBrowser({
  baseUrl, category, title, characterId, refreshKey = 0, onDelete, showEmbedding, linkChars, onLink,
}: Props) {
  const [field, setField] = useState<"title" | "content">("title");
  const [input, setInput] = useState(""); // 입력창 값
  const [q, setQ] = useState(""); // 확정된 검색어
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<DictBrowserEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // 현재 상태 재조회용
  // 자동완성
  const [sugs, setSugs] = useState<{ id: number; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const skipSuggest = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  // 편집 모달
  const [edit, setEdit] = useState<{ id: number; category: string; title: string; aliases: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  const baseParams = () => {
    const p = new URLSearchParams({ category });
    if (characterId) p.set("characterId", String(characterId));
    return p;
  };

  // 입력 300ms 디바운스 → 확정 검색어 (바뀌면 1페이지로 리셋)
  useEffect(() => {
    const t = setTimeout(() => {
      const next = input.trim();
      setQ((prev) => {
        if (prev !== next) setOffset(0);
        return next;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  // 목록 조회
  useEffect(() => {
    const my = ++reqId.current;
    const p = baseParams();
    p.set("limit", String(LIMIT));
    p.set("offset", String(offset));
    if (q) {
      p.set("q", q);
      p.set("field", field);
    }
    setLoading(true);
    fetch(`${baseUrl}?${p}`)
      .then((r) => r.json())
      .then((d) => {
        if (my !== reqId.current) return;
        const list = Array.isArray(d?.items) ? d.items : [];
        const t = Number(d?.total ?? 0);
        // 삭제 등으로 현재 페이지가 비면 마지막 페이지로
        if (list.length === 0 && t > 0 && offset > 0) {
          setOffset(Math.floor((t - 1) / LIMIT) * LIMIT);
          return;
        }
        setItems(list);
        setTotal(t);
        setLoading(false);
      })
      .catch(() => {
        if (my === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, category, characterId, q, field, offset, refreshKey, tick]);

  // 자동완성 (표제어 검색 + 2자 이상, 250ms 디바운스)
  useEffect(() => {
    if (skipSuggest.current) {
      skipSuggest.current = false;
      return;
    }
    const term = input.trim();
    if (field !== "title" || term.length < 2) {
      setSugs([]);
      return;
    }
    const t = setTimeout(() => {
      const p = baseParams();
      p.set("suggest", "1");
      p.set("q", term);
      fetch(`${baseUrl}?${p}`)
        .then((r) => r.json())
        .then((d) => {
          setSugs(Array.isArray(d) ? d : []);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, field, baseUrl, category, characterId]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (t: string) => {
    skipSuggest.current = true;
    setInput(t);
    setQ(t);
    setOffset(0);
    setOpen(false);
    setSugs([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || sugs.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % sugs.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? sugs.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(sugs[active].title);
    }
  };

  const remove = async (id: number) => {
    const r = await onDelete(id);
    if (r === false) return;
    setTick((n) => n + 1);
  };

  const link = async (id: number, v: string) => {
    await onLink?.(id, v);
    setTick((n) => n + 1);
  };

  // 편집 모달 열기
  const openEdit = (e: DictBrowserEntry) => {
    setEditErr("");
    setEdit({ id: e.id, category, title: e.title, aliases: e.aliases ?? "", content: e.content });
  };

  // 편집 저장 — PUT 에 category/title/aliases/content 를 모두 보내 임베딩이 재생성되게 한다
  const saveEdit = async () => {
    if (!edit) return;
    const t = edit.title.trim();
    if (!t) {
      setEditErr("표제어를 입력하세요.");
      return;
    }
    setSaving(true);
    setEditErr("");
    try {
      const id = edit.id;
      const res = await fetch(`/api/dictionary/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: edit.category,
          title: t,
          aliases: edit.aliases.trim() || null,
          content: edit.content,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditErr(d?.error || "저장에 실패했습니다.");
        return;
      }
      setEdit(null);
      setTick((n) => n + 1); // 현재 검색/페이지 상태 그대로 재조회
    } catch {
      setEditErr("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const showLink = category === "person" && !!linkChars && !!onLink;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const page = Math.floor(offset / LIMIT) + 1;
  const cols = 4 + (showEmbedding ? 1 : 0) + (showLink ? 1 : 0);

  return (
    <div>
      <h3>{title} ({total})</h3>
      <div className="panel">
        <div className="dict-search">
          <select
            value={field}
            onChange={(e) => {
              setField(e.target.value as "title" | "content");
              setOffset(0);
              setOpen(false);
            }}
          >
            <option value="title">표제어</option>
            <option value="content">내용</option>
          </select>
          <div className="autocomplete-wrap" ref={boxRef}>
            <input
              type="text"
              value={input}
              placeholder={`${title} 검색`}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => sugs.length > 0 && setOpen(true)}
              onKeyDown={onKeyDown}
            />
            {open && field === "title" && sugs.length > 0 && (
              <ul className="autocomplete">
                {sugs.map((s, i) => (
                  <li
                    key={s.id}
                    className={i === active ? "active" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s.title);
                    }}
                  >
                    {s.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>표제어</th><th>별칭</th><th>내용</th>
              {showEmbedding && <th>임베딩</th>}
              {showLink && <th>연결 캐릭터</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{e.title}</td>
                <td className="muted">{e.aliases}</td>
                <td title={e.content}>
                  {e.content.length > CONTENT_MAX ? `${e.content.slice(0, CONTENT_MAX)}…` : e.content}
                </td>
                {showEmbedding && <td>{e.has_embedding ? "✓" : "—"}</td>}
                {showLink && (
                  <td>
                    <select value={e.linked_character_id ?? ""} onChange={(ev) => link(e.id, ev.target.value)}>
                      <option value="">없음</option>
                      {linkChars!.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                )}
                <td>
                  <button className="small" onClick={() => openEdit(e)}>수정</button>{" "}
                  <button className="danger small" onClick={() => remove(e.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={cols} className="muted">{q ? "검색 결과가 없습니다." : "항목이 없습니다."}</td></tr>
            )}
            {loading && items.length === 0 && (
              <tr><td colSpan={cols} className="muted">불러오는 중...</td></tr>
            )}
          </tbody>
        </table>
        <div className="pager">
          <button className="small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>이전</button>
          <span>{page}/{pages} (총 {total}건)</span>
          <button className="small" disabled={page >= pages} onClick={() => setOffset(offset + LIMIT)}>다음</button>
        </div>
      </div>
      {edit && (
        <div className="modal-backdrop" onMouseDown={() => !saving && setEdit(null)}>
          <div className="modal dict-edit-modal" onMouseDown={(ev) => ev.stopPropagation()}>
            <h3>항목 수정</h3>
            <label>분류</label>
            <select value={edit.category} onChange={(ev) => setEdit({ ...edit, category: ev.target.value })} disabled={saving}>
              <option value="location">지역</option>
              <option value="person">인명</option>
              <option value="term">용어</option>
            </select>
            <label>표제어</label>
            <input type="text" value={edit.title} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} disabled={saving} />
            <label>별칭</label>
            <input type="text" value={edit.aliases} onChange={(ev) => setEdit({ ...edit, aliases: ev.target.value })} disabled={saving} />
            <label>내용</label>
            <textarea rows={8} value={edit.content} onChange={(ev) => setEdit({ ...edit, content: ev.target.value })} disabled={saving} />
            {editErr && <p className="dict-edit-err">{editErr}</p>}
            <div className="dict-edit-actions">
              <button onClick={saveEdit} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
              <button className="btn-secondary" onClick={() => setEdit(null)} disabled={saving}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
