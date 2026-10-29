"use client";

import { useEffect, useState, use } from "react";
import AnniversarySection from "./AnniversarySection";

interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  is_active: number;
  visibility?: "private" | "open";
  status?: "active" | "suspended";
  title_image_url?: string | null;
}

interface DictEntry {
  id: number;
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
  sort_order: number;
  has_embedding?: number;
  character_id?: number | null;
  character_name?: string | null;
  linked_character_id?: number | null;
}

interface CharOption {
  id: number;
  name: string;
}

const CATEGORY_LABEL = { location: "지역사전", person: "인명사전", term: "용어사전" } as const;

/** AI 분석으로 추출된 사전 후보 */
interface Candidate {
  category: DictEntry["category"];
  title: string;
  aliases: string | null;
  content: string;
  checked: boolean;
}

const candKey = (c: { category: string; title: string }) => `${c.category}\u0000${c.title}`;

export default function WorldEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [world, setWorld] = useState<World | null>(null);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [newEntry, setNewEntry] = useState({
    category: "location" as DictEntry["category"],
    title: "",
    aliases: "",
    content: "",
    character_id: "" as string, // "" = 세계관 공통, 값 = 캐릭터 전용
  });
  const [characters, setCharacters] = useState<CharOption[]>([]);
  const [bulkCharacterId, setBulkCharacterId] = useState(""); // 자동 생성 등록 대상
  const [scopeFilter, setScopeFilter] = useState("all"); // all | common | 캐릭터 id
  const [saved, setSaved] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ chunk: 0, total: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [titleUploading, setTitleUploading] = useState(false);

  // 인물 항목 ↔ 캐릭터 연결 변경
  const linkCharacter = async (entryId: number, value: string) => {
    const res = await fetch(`/api/dictionary/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linked_character_id: value ? Number(value) : null }),
    });
    if (!res.ok) alert((await res.json()).error ?? "연결 실패");
    loadDict();
  };

  const loadDict = () =>
    fetch(`/api/worlds/${id}/dictionary`).then((r) => r.json()).then(setDict);

  useEffect(() => {
    fetch(`/api/worlds/${id}`).then((r) => r.json()).then(setWorld);
    loadDict();
    fetch(`/api/characters?worldId=${id}`).then((r) => r.json()).then(setCharacters).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!world) return <p>로딩 중...</p>;

  const uploadTitleImage = async () => {
    if (!titleFile) return;
    setTitleUploading(true);
    const form = new FormData();
    form.append("file", titleFile);
    const res = await fetch(`/api/worlds/${id}/title-image`, { method: "POST", body: form });
    setTitleUploading(false);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setWorld({ ...world, title_image_url: r.url });
    setTitleFile(null);
  };

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
      body: JSON.stringify({
        ...newEntry,
        aliases: newEntry.aliases || null,
        character_id: newEntry.character_id ? Number(newEntry.character_id) : null,
      }),
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

  const analyze = async () => {
    if (files.length === 0 || analyzing) return;
    setAnalyzing(true);
    setWarnings([]);
    setCandidates([]);
    setProgress({ chunk: 0, total: 0 });
    const addWarning = (m: string) => setWarnings((prev) => [...prev, m]);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/worlds/${id}/analyze`, { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `요청 실패 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "start") {
            setProgress({ chunk: 0, total: event.totalChunks });
          } else if (event.type === "progress") {
            setProgress({ chunk: event.chunk, total: event.totalChunks });
          } else if (event.type === "entries") {
            // 같은 (category+title) 은 교체, 새 항목은 추가
            setCandidates((prev) => {
              const next = [...prev];
              for (const e of event.entries as Omit<Candidate, "checked">[]) {
                const idx = next.findIndex((c) => candKey(c) === candKey(e));
                if (idx >= 0) next[idx] = { ...e, checked: next[idx].checked };
                else next.push({ ...e, checked: true });
              }
              return next;
            });
          } else if (event.type === "warning") {
            addWarning(event.message);
          } else if (event.type === "error") {
            addWarning(`오류: ${event.message}`);
          }
        }
      }
    } catch (e) {
      addWarning(`오류: ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const checkedCount = candidates.filter((c) => c.checked).length;

  const addCandidates = async () => {
    const selected = candidates.filter((c) => c.checked);
    if (selected.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    try {
      const res = await fetch(`/api/worlds/${id}/dictionary/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character_id: bulkCharacterId ? Number(bulkCharacterId) : null,
          entries: selected.map(({ category, title, aliases, content }) => ({
            category,
            title,
            aliases,
            content,
          })),
        }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error ?? "일괄 등록 실패");
      alert(`완료: 추가 ${r.inserted}, 중복 건너뜀 ${r.skipped}`);
      setCandidates([]);
      loadDict();
    } catch (err) {
      alert(`일괄 등록 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkSaving(false);
    }
  };

  const removeEntry = async (entryId: number) => {
    await fetch(`/api/dictionary/${entryId}`, { method: "DELETE" });
    loadDict();
  };

  /** 범위 select 옵션 (세계관 공통 + 이 세계관 캐릭터) */
  const scopeOptions = (
    <>
      <option value="">세계관 공통</option>
      {characters.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </>
  );

  return (
    <>
      <h2>세계관 편집: {world.name}</h2>

      <div className="panel">
        <label>이름</label>
        <label>타이틀 이미지 (세로 3:4)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
          {world.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={world.title_image_url}
              alt="타이틀 이미지"
              style={{ width: 120, height: 160, objectFit: "cover", borderRadius: 6 }}
            />
          ) : (
            <div style={{ width: 120, height: 160, background: "#888", borderRadius: 6 }} />
          )}
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setTitleFile(e.target.files?.[0] ?? null)}
            />
            <button onClick={uploadTitleImage} disabled={titleUploading || !titleFile}>
              {titleUploading ? "업로드 중..." : "타이틀 이미지 업로드"}
            </button>
          </div>
        </div>
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
        <div className="row">
          <div>
            <label>공개 여부</label>
            <select value={world.visibility ?? "private"}
              onChange={(e) => setWorld({ ...world, visibility: e.target.value as "private" | "open" })}>
              <option value="open">공개</option>
              <option value="private">비공개</option>
            </select>
          </div>
          <div>
            <label>운영 상태</label>
            <select value={world.status ?? "active"}
              onChange={(e) => setWorld({ ...world, status: e.target.value as "active" | "suspended" })}>
              <option value="active">활성</option>
              <option value="suspended">사용중지</option>
            </select>
          </div>
        </div>
        <button onClick={saveWorld}>{saved ? "저장됨 ✓" : "저장"}</button>
      </div>

      <h3>게임 데이터로 사전 자동 생성</h3>
      <div className="panel">
        <label>등록 대상 (범위)</label>
        <select value={bulkCharacterId} onChange={(e) => setBulkCharacterId(e.target.value)}>
          {scopeOptions}
        </select>
        <input
          type="file"
          multiple
          accept=".txt,.csv,.tsv,.json,.xml,.md,.yaml,.yml"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          disabled={analyzing}
        />
        <button onClick={analyze} disabled={analyzing || files.length === 0}>
          AI 분석 시작
        </button>{" "}
        {analyzing && (
          <span className="muted">
            분석 중... (청크 {progress.chunk}/{progress.total}, 추출 {candidates.length}건)
          </span>
        )}
        {warnings.map((w, i) => (
          <div key={i} className="muted">{w}</div>
        ))}

        {candidates.length > 0 && (
          <>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={checkedCount === candidates.length}
                      onChange={(e) =>
                        setCandidates((prev) => prev.map((c) => ({ ...c, checked: e.target.checked })))
                      }
                    />
                  </th>
                  <th>분류</th><th>표제어</th><th>별칭</th><th>내용</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={candKey(c)}>
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: "auto" }}
                        checked={c.checked}
                        onChange={(e) =>
                          setCandidates((prev) =>
                            prev.map((x) => (candKey(x) === candKey(c) ? { ...x, checked: e.target.checked } : x))
                          )
                        }
                      />
                    </td>
                    <td>{CATEGORY_LABEL[c.category]}</td>
                    <td>{c.title}</td>
                    <td className="muted">{c.aliases}</td>
                    <td>{c.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addCandidates} disabled={bulkSaving || analyzing || checkedCount === 0}>
              {bulkSaving ? "추가 중..." : `선택 항목 ${checkedCount}건 사전에 추가`}
            </button>
          </>
        )}
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
            <label>범위</label>
            <select
              value={newEntry.character_id}
              onChange={(e) => setNewEntry({ ...newEntry, character_id: e.target.value })}
            >
              {scopeOptions}
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

      <div style={{ marginTop: 16 }}>
        <label>범위 필터</label>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
          <option value="all">전체</option>
          <option value="common">세계관 공통</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name} 전용</option>
          ))}
        </select>
      </div>

      {(["location", "person", "term"] as const).map((cat) => {
        const entries = dict.filter(
          (d) =>
            d.category === cat &&
            (scopeFilter === "all" ||
              (scopeFilter === "common" ? d.character_id == null : String(d.character_id) === scopeFilter))
        );
        return (
          <div key={cat}>
            <h3>{CATEGORY_LABEL[cat]} ({entries.length})</h3>
            <div className="panel">
              <table>
                <thead>
                  <tr><th>범위</th><th>표제어</th><th>별칭</th><th>내용</th><th>임베딩</th>{cat === "person" && <th>연결 캐릭터</th>}<th></th></tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.character_id == null ? "공통" : <span className="badge cond">{e.character_name}</span>}
                      </td>
                      <td>{e.title}</td>
                      <td className="muted">{e.aliases}</td>
                      <td>{e.content}</td>
                      <td>{e.has_embedding ? "✓" : "—"}</td>
                      {cat === "person" && (
                        <td>
                          <select
                            value={e.linked_character_id ?? ""}
                            onChange={(ev) => linkCharacter(e.id, ev.target.value)}
                          >
                            <option value="">없음</option>
                            {characters.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td>
                        <button className="danger small" onClick={() => removeEntry(e.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr><td colSpan={7} className="muted">항목이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <AnniversarySection worldId={id} />
    </>
  );
}
