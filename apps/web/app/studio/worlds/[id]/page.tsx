"use client";

import Link from "next/link";
import { useEffect, useState, use } from "react";
import AnniversarySection from "./AnniversarySection";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit } from "../../studio-api";

interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  visibility: "private" | "open";
  title_image_url?: string | null;
}

interface DictEntry {
  id: number;
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
  has_embedding?: number;
  character_id?: number | null;
  character_name?: string | null;
  linked_character_id?: number | null;
}

interface CharOption {
  id: number;
  name: string;
  world_id: number;
}

const CATEGORY_LABEL = { location: "지역사전", person: "인명사전", term: "용어사전" } as const;

export default function StudioWorldEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [newEntry, setNewEntry] = useState({
    category: "location" as DictEntry["category"],
    title: "",
    aliases: "",
    content: "",
    character_id: "" as string, // "" = 세계관 공통, 값 = 캐릭터 전용
  });
  const [characters, setCharacters] = useState<CharOption[]>([]);
  const [scopeFilter, setScopeFilter] = useState("all"); // all | common | 캐릭터 id
  const [saved, setSaved] = useState(false);
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [titleUploading, setTitleUploading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  // 인물 항목 ↔ 내 캐릭터 연결 변경
  const linkCharacter = async (entryId: number, value: string) => {
    const res = await studioFetch(
      `/api/studio/worlds/${id}/dictionary/${entryId}`,
      jsonInit("PUT", { linked_character_id: value ? Number(value) : null })
    );
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`연결 실패: ${r.error ?? res.statusText}`);
    }
    loadDict();
  };

  const loadDict = () =>
    studioFetch(`/api/studio/worlds/${id}/dictionary`).then((r) => r.json()).then(setDict).catch(() => {});

  useEffect(() => {
    studioFetch(`/api/studio/worlds/${id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error ?? "불러오기 실패");
      else setWorld(d);
    });
    studioFetch("/api/studio/pricing").then((r) => r.json()).then((p) => setCost(p.aiAssistCost)).catch(() => {});
    loadDict();
    // 내 캐릭터 중 이 세계관 소속만 범위 옵션으로 사용
    studioFetch("/api/studio/characters")
      .then((r) => r.json())
      .then((list: CharOption[]) =>
        setCharacters(Array.isArray(list) ? list.filter((c) => c.world_id === Number(id)) : [])
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="container studio"><p className="empty">{error}</p></div>;
  if (!world) return <div className="container studio"><p className="muted-center">로딩 중...</p></div>;

  const costLabel = cost != null ? ` (-${cost.toLocaleString()}코인)` : "";

  const save = async () => {
    const res = await studioFetch(`/api/studio/worlds/${id}`, jsonInit("PUT", world));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`저장 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  /** AI 생성 → textarea state 에 채움 (저장은 저장 버튼) */
  const generate = async (kind: "world_description" | "world_prompt", field: "description" | "ai_prompt") => {
    setGenerating(kind);
    try {
      const res = await studioFetch(
        "/api/studio/generate",
        jsonInit("POST", {
          kind,
          worldId: Number(id),
          // 저장 전 편집 중인 값을 컨텍스트에 반영
          fields: { name: world.name, description: world.description },
        })
      );
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`생성 실패: ${r.error ?? res.statusText}`);
        return;
      }
      setWorld((prev) => (prev ? { ...prev, [field]: r.text } : prev));
    } finally {
      setGenerating(null);
    }
  };

  const uploadTitleImage = async () => {
    if (!titleFile) return;
    setTitleUploading(true);
    const form = new FormData();
    form.append("file", titleFile);
    const res = await studioFetch(`/api/studio/worlds/${id}/title-image`, { method: "POST", body: form });
    setTitleUploading(false);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setWorld({ ...world, title_image_url: r.url });
    setTitleFile(null);
  };

  const addEntry = async () => {
    if (!newEntry.title.trim()) return;
    const res = await studioFetch(
      `/api/studio/worlds/${id}/dictionary`,
      jsonInit("POST", {
        ...newEntry,
        aliases: newEntry.aliases || null,
        character_id: newEntry.character_id ? Number(newEntry.character_id) : null,
      })
    );
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`추가 실패: ${r.error ?? res.statusText}`);
      return;
    }
    if (r.warning) alert(r.warning);
    setNewEntry({ ...newEntry, title: "", aliases: "", content: "" });
    loadDict();
  };

  const removeEntry = async (entryId: number) => {
    await studioFetch(`/api/studio/worlds/${id}/dictionary/${entryId}`, { method: "DELETE" });
    loadDict();
  };

  const removeWorld = async () => {
    if (!confirm("세계관을 삭제할까요? 사전과 이 세계관의 캐릭터도 함께 삭제됩니다.")) return;
    const res = await studioFetch(`/api/studio/worlds/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    router.replace("/studio");
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" style={{ color: "var(--muted)" }}>‹</Link> 세계관 편집: {world.name}
      </h2>

      <div className="panel">
        <label>타이틀 이미지 (세로 3:4)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
          {world.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={world.title_image_url} alt="타이틀 이미지" className="title-img" style={{ width: 120 }} />
          ) : (
            <div className="title-img placeholder" style={{ width: 120 }} />
          )}
          <div>
            <input type="file" accept="image/*" onChange={(e) => setTitleFile(e.target.files?.[0] ?? null)} />
            <button className="small" onClick={uploadTitleImage} disabled={titleUploading || !titleFile}>
              {titleUploading ? "업로드 중..." : "타이틀 이미지 업로드"}
            </button>
          </div>
        </div>

        <label>이름</label>
        <input value={world.name} onChange={(e) => setWorld({ ...world, name: e.target.value })} />

        <label>
          기본 세계관 설정{" "}
          <button type="button" className="small" onClick={() => generate("world_description", "description")} disabled={generating !== null}>
            {generating === "world_description" ? "생성 중..." : `AI로 생성${costLabel}`}
          </button>
        </label>
        <textarea
          rows={6}
          value={world.description}
          onChange={(e) => setWorld({ ...world, description: e.target.value })}
          placeholder="세계의 배경, 시대, 분위기, 규칙 등을 서술"
        />

        <label>
          AI 명령용 프롬프트 (세계관 공통){" "}
          <button type="button" className="small" onClick={() => generate("world_prompt", "ai_prompt")} disabled={generating !== null}>
            {generating === "world_prompt" ? "생성 중..." : `AI로 생성${costLabel}`}
          </button>
        </label>
        <textarea
          rows={6}
          value={world.ai_prompt}
          onChange={(e) => setWorld({ ...world, ai_prompt: e.target.value })}
          placeholder="이 세계관의 모든 캐릭터에게 공통 적용되는 AI 지침"
        />

        <label>공개 여부</label>
        <select value={world.visibility} onChange={(e) => setWorld({ ...world, visibility: e.target.value as "private" | "open" })}>
          <option value="private">비공개 (나만 사용)</option>
          <option value="open">공개</option>
        </select>
        <div className="notice">
          세계관을 공개하면 다른 유저가 이 세계관으로 자신의 캐릭터를 만들 수 있습니다. 공개한 세계관의 캐릭터가
          대화에 쓰이면 세계관 제작자에게 수수료가 지급됩니다.
        </div>

        <button onClick={save}>{saved ? "저장됨 ✓" : "저장"}</button>
      </div>

      <h3>사전 항목 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>분류</label>
            <select value={newEntry.category} onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value as DictEntry["category"] })}>
              <option value="location">지역사전</option>
              <option value="person">인명사전</option>
              <option value="term">용어사전</option>
            </select>
          </div>
          <div>
            <label>범위</label>
            <select value={newEntry.character_id} onChange={(e) => setNewEntry({ ...newEntry, character_id: e.target.value })}>
              <option value="">세계관 공통</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>표제어</label>
            <input value={newEntry.title} onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })} />
          </div>
          <div>
            <label>별칭 (쉼표 구분)</label>
            <input value={newEntry.aliases} onChange={(e) => setNewEntry({ ...newEntry, aliases: e.target.value })} />
          </div>
        </div>
        <label>내용</label>
        <textarea rows={3} value={newEntry.content} onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })} />
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
                  <tr><th>범위</th><th>표제어</th><th>별칭</th><th>내용</th>{cat === "person" && <th>연결 캐릭터</th>}<th></th></tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.character_id == null ? "공통" : <span className="badge cond">{e.character_name}</span>}</td>
                      <td>{e.title}</td>
                      <td className="muted">{e.aliases}</td>
                      <td>{e.content}</td>
                      {cat === "person" && (
                        <td>
                          <select value={e.linked_character_id ?? ""} onChange={(ev) => linkCharacter(e.id, ev.target.value)}>
                            <option value="">없음</option>
                            {characters.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td><button className="danger small" onClick={() => removeEntry(e.id)}>삭제</button></td>
                    </tr>
                  ))}
                  {entries.length === 0 && <tr><td colSpan={6} className="muted">항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <AnniversarySection worldId={id} />

      <button className="danger" onClick={removeWorld}>세계관 삭제</button>
    </div>
  );
}
