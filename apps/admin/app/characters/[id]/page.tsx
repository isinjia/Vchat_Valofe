"use client";

import DictionaryBrowser from "../../components/DictionaryBrowser";
import ImageCropModal from "../../components/ImageCropModal";
import ImageGenModal, { type ImageGenPayload } from "../../components/ImageGenModal";
import { useEffect, useState, use } from "react";
import CharacterProfilesSection from "./CharacterProfilesSection";
import CharacterAnniversarySection from "./CharacterAnniversarySection";
import CharacterEventsSection from "./CharacterEventsSection";
import SanctionPanel from "../../components/SanctionPanel";

interface Character {
  id: number;
  world_id: number;
  name: string;
  profile: string;
  personality: string;
  speech_style: string;
  ai_prompt: string;
  scenario?: string | null;
  greeting?: string | null;
  is_active: number;
  visibility?: "private" | "open";
  status?: "active" | "suspended";
  title_image_url?: string | null;
  owner_user_id?: number | null;
  owner_nickname?: string | null;
}

interface WorldOption { id: number; name: string; }
interface DictOption {
  id: number;
  title: string;
  category: "location" | "person" | "term";
  character_id: number | null;
}

interface Relationship {
  id: number;
  target_entry_id: number;
  target_title: string;
  target_category: "location" | "person" | "term";
  relation: string;
}

/** 캐릭터 전용 사전 항목 */
interface PrivEntry {
  id: number;
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
  has_embedding?: number;
}

const CATEGORY_LABEL = { location: "지역사전", person: "인명사전", term: "용어사전" } as const;

interface Illust {
  id: number;
  kind: "basic" | "conditional";
  url: string;
  description: string | null;
  trigger_condition: { type: string; keywords: string[]; requireEventId?: number } | string | null;
}

function triggerEventId(i: Illust): number | null {
  if (!i.trigger_condition) return null;
  try {
    const t = typeof i.trigger_condition === "string" ? JSON.parse(i.trigger_condition) : i.trigger_condition;
    return typeof t.requireEventId === "number" ? t.requireEventId : null;
  } catch {
    return null;
  }
}

function triggerKeywords(i: Illust): string[] {
  if (!i.trigger_condition) return [];
  const t = typeof i.trigger_condition === "string"
    ? JSON.parse(i.trigger_condition)
    : i.trigger_condition;
  return t.keywords ?? [];
}

/** AI 이미지 생성 모달 자동 채움 프롬프트 (편집 중인 폼 값 사용) */
const buildImagePrompt = (
  c: { name: string; profile: string; personality: string; ai_prompt: string },
  asTitle: boolean,
  extra?: { kind: "basic" | "conditional"; description: string; keywords: string }
) => {
  let p = `캐릭터 일러스트를 생성한다.${asTitle ? " 세로형 3:4 타이틀 일러스트." : ""}\n이름: ${c.name}\n외모/설정: ${c.profile}\n성격: ${c.personality}`;
  if (c.ai_prompt?.trim()) p += `\n상세 설정: ${c.ai_prompt.trim().slice(0, 500)}`;
  if (!asTitle && extra?.kind === "conditional") {
    if (extra.description.trim()) p += `\n장면 설명: ${extra.description.trim()}`;
    if (extra.keywords.trim()) p += `\n표현할 상황/감정 키워드: ${extra.keywords.trim()}`;
  }
  return p;
};

export default function CharacterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [char, setChar] = useState<Character | null>(null);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  // 관계 대상 후보: 세계관 공통 사전 항목(인물·지역·용어)
  const [entries, setEntries] = useState<DictOption[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const [rels, setRels] = useState<Relationship[]>([]);
  const [illusts, setIllusts] = useState<Illust[]>([]);
  const [events, setEvents] = useState<{ id: number; name: string }[]>([]);
  const [upReqEvent, setUpReqEvent] = useState(""); // 업로드: 이벤트 달성 필요
  const [aiReqEvent, setAiReqEvent] = useState(""); // AI 생성: 이벤트 달성 필요
  // 전용 사전: 이 캐릭터만 아는 지식
  const [privKey, setPrivKey] = useState(0); // 전용 사전 목록 재조회 트리거
  const [newPriv, setNewPriv] = useState({ category: "term" as PrivEntry["category"], title: "", aliases: "", content: "" });
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("basic"); // 편집 탭

  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [upload, setUpload] = useState({
    kind: "basic" as "basic" | "conditional",
    description: "",
    keywords: "",
  });
  const [illustCropOpen, setIllustCropOpen] = useState(false); // 일러스트 크롭 팝업
  const [genModal, setGenModal] = useState<null | "illust" | "title">(null); // AI 이미지 생성 모달
  const [ai, setAi] = useState({
    kind: "basic" as "basic" | "conditional",
    keywords: "",
    description: "",
  });
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업
  // AI 생성 중인 필드 (scenario | greeting)
  const [generating, setGenerating] = useState<"scenario" | "greeting" | null>(null);

  const loadRels = () =>
    fetch(`/api/characters/${id}/relationships`).then((r) => r.json()).then(setRels);
  const loadIllusts = () =>
    fetch(`/api/characters/${id}/illustrations`).then((r) => r.json()).then(setIllusts);
  const loadEvents = () =>
    fetch(`/api/characters/${id}/events`).then((r) => r.json()).then((d) => setEvents(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    fetch(`/api/characters/${id}`)
      .then((r) => r.json())
      .then((c: Character) => {
        setChar(c);
        // 관계 대상 후보: 공용 사전 전체 (페이징 API 를 100건씩 순회)
        (async () => {
          const all: DictOption[] = [];
          for (let off = 0; ; off += 100) {
            const r = await fetch(`/api/worlds/${c.world_id}/dictionary?limit=100&offset=${off}`);
            const d = await r.json().catch(() => null);
            const items: DictOption[] = Array.isArray(d?.items) ? d.items : [];
            all.push(...items);
            if (items.length < 100) break;
          }
          setEntries(all.filter((x) => x.character_id == null));
        })().catch(() => {});
      });
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);
    loadRels();
    loadIllusts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!char) return <p>로딩 중...</p>;

  const save = async () => {
    const res = await fetch(`/api/characters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(char),
    });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`저장 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  /** 상황 설정/첫 인사말 AI 생성 → textarea state 에 채움 (저장은 저장 버튼) */
  const generate = async (field: "scenario" | "greeting") => {
    setGenerating(field);
    try {
      const res = await fetch(`/api/characters/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          // 저장 전 편집 중인 값을 프롬프트에 반영하기 위해 함께 전달
          scenario: char.scenario ?? "",
        }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`생성 실패: ${r.error ?? res.statusText}`);
        return;
      }
      setChar((prev) => (prev ? { ...prev, [field]: r.text } : prev));
    } finally {
      setGenerating(null);
    }
  };

  /** 크롭 팝업 확인 → 타이틀 이미지 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const uploadTitleImage = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await fetch(`/api/characters/${id}/title-image`, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    setChar((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
  };

  const addRel = async () => {
    if (!newRel.target || !newRel.relation.trim()) return;
    await fetch(`/api/characters/${id}/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_entry_id: newRel.target, relation: newRel.relation }),
    });
    setNewRel({ target: "", relation: "" });
    loadRels();
  };

  // 새 인물 간단 등록: 세계관 공통 person 항목을 먼저 만들고 그 id 로 관계 생성
  const addRelWithNewPerson = async () => {
    const name = newPerson.trim();
    if (!name || !newRel.relation.trim()) {
      alert("새 인물 이름과 관계 설명을 입력하세요.");
      return;
    }
    const d = await fetch(`/api/worlds/${char.world_id}/dictionary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "person", title: name, content: name }),
    });
    if (!d.ok) {
      alert((await d.json()).error ?? "인물 등록 실패");
      return;
    }
    const { id: entryId } = await d.json();
    await fetch(`/api/characters/${id}/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_entry_id: entryId, relation: newRel.relation }),
    });
    setNewPerson("");
    setNewRel({ target: "", relation: "" });
    setEntries((prev) => [...prev, { id: entryId, title: name, category: "person", character_id: null }]);
    loadRels();
  };

  const removeRel = async (relId: number) => {
    await fetch(`/api/relationships/${relId}`, { method: "DELETE" });
    loadRels();
  };

  const addPriv = async () => {
    if (!newPriv.title.trim()) return;
    const res = await fetch(`/api/worlds/${char.world_id}/dictionary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newPriv, aliases: newPriv.aliases || null, character_id: Number(id) }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`추가 실패: ${r.error ?? res.statusText}`);
      return;
    }
    if (r.warning) alert(r.warning);
    setNewPriv({ ...newPriv, title: "", aliases: "", content: "" });
    setPrivKey((n) => n + 1);
  };

  const removePriv = async (entryId: number) => {
    if (!confirm("전용 사전 항목을 삭제할까요?")) return false;
    await fetch(`/api/dictionary/${entryId}`, { method: "DELETE" });
  };

  /** 업로드 버튼: 조건부인데 키워드가 비면 팝업 열기 전에 검증 */
  const openUpload = () => {
    if (upload.kind === "conditional" && !upload.keywords.trim() && !upReqEvent) {
      alert("조건부 일러스트는 트리거 키워드 또는 이벤트 조건이 필요합니다.");
      return;
    }
    setIllustCropOpen(true);
  };

  /** 크롭 팝업 확인 → 현재 폼 값과 함께 일러스트 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const doUpload = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("kind", upload.kind);
    form.append("description", upload.description);
    form.append("keywords", upload.keywords);
    if (upReqEvent) form.append("requireEventId", upReqEvent);
    const res = await fetch(`/api/characters/${id}/illustrations`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`업로드 실패: ${err.error ?? res.statusText}`);
    }
    setUpload({ kind: "basic", description: "", keywords: "" });
    setUpReqEvent("");
    loadIllusts();
  };

  /** 생성 모달 확인 → AI 일러스트/타이틀 생성 (실패 시 throw → 모달 안에 에러 표시) */
  const doAiGenerate = async (p: ImageGenPayload, asTitle: boolean) => {
    const res = await fetch(`/api/characters/${id}/illustrations/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: p.prompt,
        kind: ai.kind,
        keywords: ai.keywords,
        requireEventId: aiReqEvent ? Number(aiReqEvent) : undefined,
        description: ai.description,
        asTitle,
        refTitleImage: p.refTitleImage,
        refImages: p.refImages,
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    if (asTitle) setChar((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
    else {
      loadIllusts();
      setAi((prev) => ({ ...prev, description: "", keywords: "" }));
      setAiReqEvent("");
    }
  };

  const removeIllust = async (illustId: number) => {
    if (!confirm("일러스트를 삭제할까요?")) return;
    await fetch(`/api/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  return (
    <>
      <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        캐릭터 편집: {char.name}
        <a href={`/api/characters/${char.id}/export`} download>
          <button type="button" className="small btn-secondary">JSON 내보내기</button>
        </a>
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
          제작자:{" "}
          {char.owner_user_id ? (
            <a href={`/users/${char.owner_user_id}`} style={{ textDecoration: "underline" }}>
              {char.owner_nickname ?? "유저"} #{char.owner_user_id}
            </a>
          ) : (
            "운영"
          )}
        </span>
      </h2>

      {/* 탭 바: 비활성 탭도 언마운트하지 않고 display:none 으로만 숨겨 입력값/fetch 상태 보존 */}
      <div className="tabs">
        <button type="button" className={`tab ${tab === "basic" ? "active" : ""}`} onClick={() => setTab("basic")}>기본 설정</button>
        <button type="button" className={`tab ${tab === "rel" ? "active" : ""}`} onClick={() => setTab("rel")}>관계·기억·기념일</button>
        <button type="button" className={`tab ${tab === "dict" ? "active" : ""}`} onClick={() => setTab("dict")}>전용 사전</button>
        <button type="button" className={`tab ${tab === "event" ? "active" : ""}`} onClick={() => setTab("event")}>이벤트</button>
        <button type="button" className={`tab ${tab === "illust" ? "active" : ""}`} onClick={() => setTab("illust")}>일러스트</button>
      </div>

      <div style={{ display: tab === "basic" ? undefined : "none" }}>
      <div className="panel">
        {/* 타이틀 이미지: label 과 분리된 독립 블록 */}
        <div style={{ marginBottom: 12 }}>
          <label>타이틀 이미지 (세로 3:4)</label>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
            {char.title_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={char.title_image_url}
                alt="타이틀 이미지"
                style={{ width: 120, height: 160, objectFit: "cover", borderRadius: 6 }}
              />
            ) : (
              <div style={{ width: 120, height: 160, background: "#888", borderRadius: 6 }} />
            )}
            <div>
              <button type="button" onClick={() => setTitleCropOpen(true)}>이미지 업로드</button>{" "}
              <button type="button" onClick={() => setGenModal("title")}>AI 생성</button>
            </div>
          </div>
          <ImageCropModal
            open={titleCropOpen}
            title="타이틀 이미지 업로드"
            aspect={3 / 4}
            onCancel={() => setTitleCropOpen(false)}
            onConfirm={uploadTitleImage}
          />
          <CharacterProfilesSection characterId={char.id} />
        </div>
        <div className="row">
          <div>
            <label>이름</label>
            <input value={char.name} onChange={(e) => setChar({ ...char, name: e.target.value })} />
          </div>
          <div>
            <label>세계관</label>
            <select
              value={char.world_id}
              onChange={(e) => setChar({ ...char, world_id: Number(e.target.value) })}
            >
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        </div>
        <label>캐릭터 설정</label>
        <textarea
          rows={5}
          value={char.profile}
          onChange={(e) => setChar({ ...char, profile: e.target.value })}
          placeholder="출신, 외모, 배경 스토리 등"
        />
        <label>기본 성격</label>
        <textarea
          rows={3}
          value={char.personality}
          onChange={(e) => setChar({ ...char, personality: e.target.value })}
        />
        <label>말투</label>
        <textarea
          rows={3}
          value={char.speech_style}
          onChange={(e) => setChar({ ...char, speech_style: e.target.value })}
          placeholder="예: 존댓말, 특정 어미 사용, 자주 쓰는 감탄사 등"
        />
        <label>캐릭터별 세세한 프롬프트</label>
        <textarea
          rows={6}
          value={char.ai_prompt}
          onChange={(e) => setChar({ ...char, ai_prompt: e.target.value })}
          placeholder="이 캐릭터에게만 적용되는 상세 AI 지침"
        />
        <label>
          상황 설정 (대화 시작 배경){" "}
          <button
            type="button"
            className="small"
            onClick={() => generate("scenario")}
            disabled={generating !== null}
          >
            {generating === "scenario" ? "생성 중..." : "AI로 생성"}
          </button>
        </label>
        <textarea
          rows={4}
          value={char.scenario ?? ""}
          onChange={(e) => setChar({ ...char, scenario: e.target.value })}
          placeholder="예: 비 내리는 저녁, 길드 주점. 신입 모험가인 유저가 처음 찾아온 참이다."
        />
        <label>
          첫 인사말 (비우면 AI 가 자동 생성){" "}
          <button
            type="button"
            className="small"
            onClick={() => generate("greeting")}
            disabled={generating !== null}
          >
            {generating === "greeting" ? "생성 중..." : "AI로 생성"}
          </button>
        </label>
        <textarea
          rows={3}
          value={char.greeting ?? ""}
          onChange={(e) => setChar({ ...char, greeting: e.target.value })}
          placeholder="캐릭터가 대화 시작 시 먼저 건네는 말. 비우면 유저 첫 입장 시 AI 가 생성(코인 소모)"
        />
        <label>
          <input
            type="checkbox"
            checked={!!char.is_active}
            onChange={(e) => setChar({ ...char, is_active: e.target.checked ? 1 : 0 })}
            style={{ width: "auto", marginRight: 6 }}
          />
          활성화 (유저 화면에 노출)
        </label>
        <div className="row">
          <div>
            <label>공개 여부</label>
            <select value={char.visibility ?? "private"}
              onChange={(e) => setChar({ ...char, visibility: e.target.value as "private" | "open" })}>
              <option value="open">공개</option>
              <option value="private">비공개</option>
            </select>
          </div>
          <div>
            <label>운영 상태</label>
            <select value={char.status ?? "active"}
              onChange={(e) => setChar({ ...char, status: e.target.value as "active" | "suspended" })}>
              <option value="active">활성</option>
              <option value="suspended">사용중지</option>
            </select>
          </div>
        </div>
        <button onClick={save}>{saved ? "저장됨 ✓" : "저장"}</button>
        <a href={`/api/characters/${id}/export`} download style={{ marginLeft: 12 }}>내보내기 (JSON)</a>
      </div>
      <SanctionPanel targetType="character" targetId={id} />
      </div>

      <div style={{ display: tab === "rel" ? undefined : "none" }}>
      <h3>인물·장소와의 관계/기억</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>세계관 사전에서 선택 (인물·지역·용어)</label>
            <select
              value={newRel.target}
              onChange={(e) => setNewRel({ ...newRel, target: Number(e.target.value) || "" })}
            >
              <option value="">선택...</option>
              {(["person", "location", "term"] as const).map((cat) => (
                <optgroup key={cat} label={cat === "person" ? "인명사전" : cat === "location" ? "지역사전" : "용어사전"}>
                  {entries.filter((d) => d.category === cat).map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label>관계/기억 설명</label>
            <input
              value={newRel.relation}
              onChange={(e) => setNewRel({ ...newRel, relation: e.target.value })}
              placeholder="예: 소꿉친구이자 라이벌 / (장소) 스텔라와 처음 소풍 간 곳"
            />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button style={{ marginTop: 0 }} onClick={addRel}>추가</button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <label>새 인물 간단 등록 (이름)</label>
            <input
              value={newPerson}
              onChange={(e) => setNewPerson(e.target.value)}
              placeholder="인물사전에 없는 인물 — 위 관계 설명과 함께 등록"
            />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button style={{ marginTop: 0 }} onClick={addRelWithNewPerson}>인물 등록 + 관계 추가</button>
          </div>
        </div>
        <table style={{ marginTop: 14 }}>
          <tbody>
            {rels.map((r) => (
              <tr key={r.id}>
                <td style={{ width: 140 }}><b>{r.target_title}</b></td>
                <td>{r.relation}</td>
                <td style={{ width: 70 }}>
                  <button className="danger small" onClick={() => removeRel(r.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {rels.length === 0 && (
              <tr><td className="muted">등록된 관계가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CharacterAnniversarySection characterId={id} />
      </div>

      <div style={{ display: tab === "dict" ? undefined : "none" }}>
      <h3>전용 사전 (이 캐릭터만 아는 지식)</h3>
      <div className="panel">
        <p className="muted">RAG 검색 대상입니다. 공용 사전과 함께 이 캐릭터의 대화에만 주입됩니다.</p>
        <div className="row">
          <div>
            <label>분류</label>
            <select value={newPriv.category} onChange={(e) => setNewPriv({ ...newPriv, category: e.target.value as PrivEntry["category"] })}>
              <option value="location">지역사전</option>
              <option value="person">인명사전</option>
              <option value="term">용어사전</option>
            </select>
          </div>
          <div>
            <label>표제어</label>
            <input value={newPriv.title} onChange={(e) => setNewPriv({ ...newPriv, title: e.target.value })} />
          </div>
          <div>
            <label>별칭 (쉼표 구분)</label>
            <input value={newPriv.aliases} onChange={(e) => setNewPriv({ ...newPriv, aliases: e.target.value })} />
          </div>
        </div>
        <label>내용</label>
        <textarea rows={3} value={newPriv.content} onChange={(e) => setNewPriv({ ...newPriv, content: e.target.value })} />
        <button onClick={addPriv}>전용 항목 추가</button>
      </div>

      {(["location", "person", "term"] as const).map((cat) => (
        <DictionaryBrowser
          key={cat}
          baseUrl={`/api/worlds/${char.world_id}/dictionary`}
          characterId={Number(id)}
          category={cat}
          title={`전용 ${CATEGORY_LABEL[cat]}`}
          refreshKey={privKey}
          onDelete={removePriv}
          showEmbedding
        />
      ))}
      </div>

      <div style={{ display: tab === "event" ? undefined : "none" }}>
        <CharacterEventsSection characterId={id} onChanged={loadEvents} />
      </div>

      <div style={{ display: tab === "illust" ? undefined : "none" }}>
      <h3>일러스트</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>종류</label>
            <select
              value={upload.kind}
              onChange={(e) =>
                setUpload({ ...upload, kind: e.target.value as "basic" | "conditional" })
              }
            >
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input
              value={upload.description}
              onChange={(e) => setUpload({ ...upload, description: e.target.value })}
            />
          </div>
        </div>
        {upload.kind === "conditional" && (
          <>
            <label>트리거 키워드 (쉼표 구분 — 응답에 이 단어가 포함되면 노출)</label>
            <input
              value={upload.keywords}
              onChange={(e) => setUpload({ ...upload, keywords: e.target.value })}
              placeholder="예: 화남, 분노, 짜증"
            />
            <label>이벤트 달성 필요</label>
            <select value={upReqEvent} onChange={(e) => setUpReqEvent(e.target.value)}>
              <option value="">없음</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            <div className="muted">지정하면 그 이벤트를 성공한 유저에게만 노출됩니다. 키워드 없이 지정하면 달성 후 기본 로테이션에 포함됩니다.</div>
          </>
        )}
<button onClick={openUpload}>이미지 선택·업로드</button>
        <ImageCropModal
          open={illustCropOpen}
          title="일러스트 업로드"
          aspect="free"
          onCancel={() => setIllustCropOpen(false)}
          onConfirm={doUpload}
        />
        <p className="muted" style={{ marginTop: 8 }}>
          업로드 대상(S3/FTP)은 설정 메뉴에서 지정합니다.
        </p>
      </div>

      <h3>AI 일러스트 생성</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>종류</label>
            <select value={ai.kind} onChange={(e) => setAi({ ...ai, kind: e.target.value as "basic" | "conditional" })}>
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input value={ai.description} onChange={(e) => setAi({ ...ai, description: e.target.value })} />
          </div>
        </div>
        {ai.kind === "conditional" && (
          <>
            <label>트리거 키워드 (쉼표 구분)</label>
            <input value={ai.keywords} onChange={(e) => setAi({ ...ai, keywords: e.target.value })} placeholder="예: 화남, 분노, 짜증" />
            <label>이벤트 달성 필요</label>
            <select value={aiReqEvent} onChange={(e) => setAiReqEvent(e.target.value)}>
              <option value="">없음</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            <div className="muted">지정하면 그 이벤트를 성공한 유저에게만 노출됩니다. 키워드 없이 지정하면 달성 후 기본 로테이션에 포함됩니다.</div>
          </>
        )}
        <button
          onClick={() => {
            if (ai.kind === "conditional" && !ai.keywords.trim() && !aiReqEvent) {
              alert("조건부 일러스트는 트리거 키워드 또는 이벤트 조건이 필요합니다.");
              return;
            }
            setGenModal("illust");
          }}
        >
          AI 일러스트 생성
        </button>
        <ImageGenModal
          open={genModal !== null}
          title={genModal === "title" ? "AI 타이틀 이미지 생성" : "AI 일러스트 생성"}
          initialPrompt={buildImagePrompt(char, genModal === "title", ai)}
          titleImageUrl={char.title_image_url}
          onClose={() => setGenModal(null)}
          onGenerate={(p) => doAiGenerate(p, genModal === "title")}
        />
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>미리보기</th><th>종류</th><th>설명</th><th>트리거 키워드</th><th></th></tr>
          </thead>
          <tbody>
            {illusts.map((i) => (
              <tr key={i.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><img src={i.url} alt={i.description ?? ""} className="thumb" /></td>
                <td>
                  <span className={`badge ${i.kind === "conditional" ? "cond" : ""}`}>
                    {i.kind === "conditional" ? "조건부" : "기본"}
                  </span>
                </td>
                <td>{i.description}</td>
                <td className="muted">
                  {triggerKeywords(i).join(", ")}
                  {triggerEventId(i) != null && (
                    <div>이벤트: {events.find((ev) => ev.id === triggerEventId(i))?.name ?? `#${triggerEventId(i)}`}</div>
                  )}
                </td>
                <td><button className="danger small" onClick={() => removeIllust(i.id)}>삭제</button></td>
              </tr>
            ))}
            {illusts.length === 0 && (
              <tr><td colSpan={5} className="muted">등록된 일러스트가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
