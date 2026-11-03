"use client";

import { useEffect, useRef, useState } from "react";

/** 사전 항목 콤보박스 옵션 (관계/기억 대상 선택 등) */
export interface DictSearchOption {
  id: number;
  title: string;
  category: "location" | "person" | "term";
}

const CAT_LABEL: Record<string, string> = { person: "인명", location: "지역", term: "용어" };

/**
 * 세계관 사전 검색 콤보박스: 입력하면 리스트가 검색으로 좁혀지고 클릭으로 선택한다.
 * (항목이 많아지면 <select> 로는 찾기 어려워서 — 입력창이 검색창을 겸한다)
 */
export default function DictSearchSelect({
  entries,
  value,
  onChange,
  placeholder = "이름/표제어로 검색...",
}: {
  entries: DictSearchOption[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = entries.find((d) => d.id === value) ?? null;
  const query = q.trim().toLowerCase();
  const list = query ? entries.filter((d) => d.title.toLowerCase().includes(query)) : entries;

  return (
    <div className="dict-combo" ref={wrapRef}>
      <input
        value={open ? q : selected?.title ?? ""}
        placeholder={selected ? selected.title : placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          if (!open) setOpen(true);
        }}
      />
      {open && (
        <div className="dict-combo-menu">
          {value !== "" && (
            <button
              type="button"
              className="dict-combo-item muted"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              선택 해제
            </button>
          )}
          {list.slice(0, 100).map((d) => (
            <button
              key={d.id}
              type="button"
              className={`dict-combo-item${d.id === value ? " sel" : ""}`}
              onClick={() => {
                onChange(d.id);
                setOpen(false);
              }}
            >
              <span className="dict-combo-cat">{CAT_LABEL[d.category] ?? d.category}</span>
              {d.title}
            </button>
          ))}
          {list.length === 0 && <div className="dict-combo-empty">검색 결과가 없습니다</div>}
        </div>
      )}
    </div>
  );
}
