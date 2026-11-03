"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { studioFetch, jsonInit } from "../../../studio-api";

interface StoryItem {
  id: number;
  title: string;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
}

/** 캐릭터 스토리 목록 — 생성/삭제 + 에디터로 이동 */
export default function CharacterStoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [list, setList] = useState<StoryItem[]>([]);
  const [who, setWho] = useState<{ name: string; world_name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const base = `/api/studio/characters/${id}/stories`;

  const load = () =>
    studioFetch(base)
      .then((r) => r.json())
      .then((d) => {
        setList(Array.isArray(d?.stories) ? d.stories : []);
        if (d?.character) setWho(d.character);
      })
      .catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const create = async () => {
    setError("");
    const r = await studioFetch(base, jsonInit("POST", { title }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(d.error ?? "생성 실패");
      return;
    }
    window.location.href = `/studio/characters/${id}/stories/${d.id}`;
  };

  const remove = async (s: StoryItem) => {
    if (!confirm(`"${s.title}" 스토리를 삭제할까요? 유저 진행 기록도 함께 삭제됩니다.`)) return;
    await studioFetch(`${base}/${s.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href={`/studio/characters/${id}`} className="back-link" title="캐릭터 편집으로">‹</Link> 스토리 모드
        {who && <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>— {who.world_name} / {who.name}</span>}
      </h2>
      <div className="panel">
        <div className="notice">
          캐릭터에 속한 분기형 시나리오입니다. 스토리보드에서 스토리 카드·선택지·분기점을 연결해 만들고,
          공개하면 유저가 채팅 화면의 &quot;스토리&quot; 메뉴에서 선택해 플레이할 수 있습니다. 일반 대화/이벤트 채팅과는 별개로 진행됩니다.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1 }}
            placeholder="새 스토리 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && title.trim() && create()}
          />
          <button onClick={create} disabled={!title.trim()} style={{ marginTop: 0 }}>스토리 만들기</button>
        </div>
        {error && <p style={{ color: "#d64545", marginTop: 8 }}>{error}</p>}
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr><th>제목</th><th>상태</th><th>마지막 수정</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/studio/characters/${id}/stories/${s.id}`}>{s.title}</Link></td>
                <td>{s.status === "published" ? <span className="badge">공개</span> : <span className="muted">임시저장</span>}</td>
                <td className="muted">{String(s.updated_at).slice(0, 16).replace("T", " ")}</td>
                <td>
                  <Link href={`/studio/characters/${id}/stories/${s.id}`}><button className="small" style={{ marginTop: 0 }}>편집</button></Link>{" "}
                  <button className="danger small" style={{ marginTop: 0 }} onClick={() => remove(s)}>삭제</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="muted">아직 스토리가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
