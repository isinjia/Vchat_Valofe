"use client";

import { useEffect, useState, use } from "react";
import AnniversarySection from "./AnniversarySection";
import DictionaryBrowser from "../../components/DictionaryBrowser";
import ImageCropModal from "../../components/ImageCropModal";

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
  const [dictKey, setDictKey] = useState(0); // 사전 목록 재조회 트리거
  const [newEntry, setNewEntry] = useState({
    category: "location" as DictEntry["category"],
    title: "",
    aliases: "",
    content: "",
  });
  const [characters, setCharacters] = useState<CharOption[]>([]);
  const [bulkCharacterId, setBulkCharacterId] = useState(""); // 자동 생성 등록 대상
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("basic"); // 편집 탭
  const [reindexing, setReindexing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ chunk: 0, total: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업

  // 인물 항목 ↔ 캐릭터 연결 변경
  const linkCharacter = async (entryId: number, value: string) => {
    const res = await fetch(`/api/dictionary/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linked_character_id: value ? Number(value) : null }),
    });
    if (!res.ok) alert((await res.json()).error ?? "연결 실패");
  };

  const loadDict = () => setDictKey((n) => n + 1);

  useEffect(() => {
    fetch(`/api/worlds/${id}`).then((r) => r.json()).then(setWorld);
    fetch(`/api/characters?worldId=${id}`).then((r) => r.json()).then(setCharacters).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!world) return <p>로딩 중...</p>;

  /** 크롭 팝업 확인 → 타이틀 이미지 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const uploadTitleImage = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await fetch(`/api/worlds/${id}/title-image`, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    setWorld((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
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
        character_id: null, // 이 화면은 공용 사전 전용 (캐릭터 전용은 캐릭터 편집에서 관리)
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
  };

  /** 등록 대상 select 옵션 (세계관 공통 + 이 세계관 캐릭터) */
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

      {/* 탭 바: 비활성 탭도 언마운트하지 않고 display:none 으로만 숨겨 입력값/fetch 상태 보존 */}
      <div className="tabs">
        <button type="button" className={`tab ${tab === "basic" ? "active" : ""}`} onClick={() => setTab("basic")}>기본</button>
        <button type="button" className={`tab ${tab === "dict" ? "active" : ""}`} onClick={() => setTab("dict")}>사전</button>
        <button type="button" className={`tab ${tab === "anniv" ? "active" : ""}`} onClick={() => setTab("anniv")}>기념일</button>
      </div>

      <div style={{ display: tab === "basic" ? undefined : "none" }}>
      <div className="panel">
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
            <button type="button" onClick={() => setTitleCropOpen(true)}>이미지 업로드</button>
          </div>
        </div>
        <ImageCropModal
          open={titleCropOpen}
          title="타이틀 이미지 업로드"
          aspect={3 / 4}
          onCancel={() => setTitleCropOpen(false)}
          onConfirm={uploadTitleImage}
        />
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
      </div>

      <div style={{ display: tab === "dict" ? undefined : "none" }}>
      <h3>게임 데이터로 사전 자동 생성</h3>
      <div className="panel">
        <label>등록 대상 (범위)</label>
        <select value={bulkCharacterId} onChange={(e) => setBulkCharacterId(e.target.value)}>
          {scopeOptions}
        </select>
        {bulkCharacterId && (
          <p className="muted">등록 후 해당 캐릭터 편집 화면의 &apos;전용 사전&apos;에서 확인됩니다.</p>
        )}
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

      {(["location", "person", "term"] as const).map((cat) => (
        <DictionaryBrowser
          key={cat}
          baseUrl={`/api/worlds/${id}/dictionary`}
          category={cat}
          title={CATEGORY_LABEL[cat]}
          refreshKey={dictKey}
          onDelete={removeEntry}
          showEmbedding
          linkChars={characters}
          onLink={linkCharacter}
        />
      ))}
      </div>

      <div style={{ display: tab === "anniv" ? undefined : "none" }}>
      <AnniversarySection worldId={id} />
      </div>
    </>
  );
}
