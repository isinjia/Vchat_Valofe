"use client";

import { useEffect, useState, use } from "react";

interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  is_active: number;
}

interface DictEntry {
  id: number;
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
  sort_order: number;
  has_embedding?: number;
}

const CATEGORY_LABEL = { location: "지역사전", person: "인명사전", term: "용어사전" } as const;

export default function WorldEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [world, setWorld] = useState<World | null>(null);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [newEntry, setNewEntry] = useState({
    category: "location" as DictEntry["category"],
    title: "",
    aliases: "",
    content: "",
  });
  const [saved, setSaved] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const loadDict = () =>
    fetch(`/api/worlds/${id}/dictionary`).then((r) => r.json()).then(setDict);

  useEffect(() => {
    fetch(`/api/worlds/${id}`).then((r) => r.json()).then(setWorld);
    loadDict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!world) return <p>로딩 중...</p>;

  const saveWorld = async () => {
    await fetch(`/api/worlds/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(world),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addEntry = async () => {
    if (!newEntry.title.trim()) return;
    await fetch(`/api/worlds/${id}/dictionary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newEntry, aliases: newEntry.aliases || null }),
    });
    setNewEntry({ ...newEntry, title: "", aliases: "", content: "" });
    loadDict();
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch(`/api/worlds/${id}/reindex`, { method: "POST" });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error ?? "재색인 실패");
      alert(`완료: ${r.indexed}/${r.total}건${r.failed ? ` (실패 ${r.failed}건)` : ""}`);
    } catch (err) {
      alert(`재색인 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReindexing(false);
      loadDict();
    }
  };

  const removeEntry = async (entryId: number) => {
    await fetch(`/api/dictionary/${entryId}`, { method: "DELETE" });
    loadDict();
  };

  return (
    <>
      <h2>세계관 편집: {world.name}</h2>

      <div className="panel">
        <label>이름</label>
        <input value={world.name} onChange={(e) => setWorld({ ...world, name: e.target.value })} />
        <label>기본 세계관 설정</label>
        <textarea
          rows={6}
          value={world.description}
          onChange={(e) => setWorld({ ...world, description: e.target.value })}
          placeholder="세계의 배경, 시대, 분위기, 규칙 등을 서술"
        />
        <label>AI 명령용 프롬프트 (세계관 공통)</label>
        <textarea
          rows={6}
          value={world.ai_prompt}
          onChange={(e) => setWorld({ ...world, ai_prompt: e.target.value })}
          placeholder="이 세계관의 모든 캐릭터에게 공통 적용되는 AI 지침"
        />
        <label>
          <input
            type="checkbox"
            checked={!!world.is_active}
            onChange={(e) => setWorld({ ...world, is_active: e.target.checked ? 1 : 0 })}
            style={{ width: "auto", marginRight: 6 }}
          />
          활성화 (유저 화면에 노출)
        </label>
        <button onClick={saveWorld}>{saved ? "저장됨 ✓" : "저장"}</button>
      </div>

      <h3>사전 항목 추가</h3>
      <div style={{ marginBottom: 8 }}>
        <button className="small" onClick={reindex} disabled={reindexing}>임베딩 재색인</button>{" "}
        {reindexing && <span className="muted">재색인 중...(수 분 걸릴 수 있음)</span>}
      </div>
      <div className="panel">
        <div className="row">
          <div>
            <label>분류</label>
            <select
              value={newEntry.category}
              onChange={(e) =>
                setNewEntry({ ...newEntry, category: e.target.value as DictEntry["category"] })
              }
            >
              <option value="location">지역사전</option>
              <option value="person">인명사전</option>
              <option value="term">용어사전</option>
            </select>
          </div>
          <div>
            <label>표제어</label>
            <input
              value={newEntry.title}
              onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })}
            />
          </div>
          <div>
            <label>별칭 (쉼표 구분)</label>
            <input
              value={newEntry.aliases}
              onChange={(e) => setNewEntry({ ...newEntry, aliases: e.target.value })}
            />
          </div>
        </div>
        <label>내용</label>
        <textarea
          rows={3}
          value={newEntry.content}
          onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })}
        />
        <button onClick={addEntry}>항목 추가</button>
      </div>

      {(["location", "person", "term"] as const).map((cat) => {
        const entries = dict.filter((d) => d.category === cat);
        return (
          <div key={cat}>
            <h3>{CATEGORY_LABEL[cat]} ({entries.length})</h3>
            <div className="panel">
              <table>
                <thead>
                  <tr><th>표제어</th><th>별칭</th><th>내용</th><th>임베딩</th><th></th></tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.title}</td>
                      <td className="muted">{e.aliases}</td>
                      <td>{e.content}</td>
                      <td>{e.has_embedding ? "✓" : "—"}</td>
                      <td>
                        <button className="danger small" onClick={() => removeEntry(e.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr><td colSpan={5} className="muted">항목이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
