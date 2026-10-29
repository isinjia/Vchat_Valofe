"use client";

import { useEffect, useState, use } from "react";
import CharacterAnniversarySection from "./CharacterAnniversarySection";

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

interface Illust {
  id: number;
  kind: "basic" | "conditional";
  url: string;
  description: string | null;
  trigger_condition: { type: string; keywords: string[] } | string | null;
}

function triggerKeywords(i: Illust): string[] {
  if (!i.trigger_condition) return [];
  const t = typeof i.trigger_condition === "string"
    ? JSON.parse(i.trigger_condition)
    : i.trigger_condition;
  return t.keywords ?? [];
}

/** AI 일러스트 기본 프롬프트: 캐릭터 이름 + 프로필 첫 문장 */
const defaultIllustPrompt = (c: { name: string; profile: string }) => {
  const first = (c.profile ?? "").split(/(?<=[.!?。])\s|\n/)[0]?.trim() ?? "";
  return `${c.name}, ${first} 세로형 캐릭터 일러스트, 고품질`.replace(/\s+/g, " ").trim();
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
  const [saved, setSaved] = useState(false);

  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [upload, setUpload] = useState({
    kind: "basic" as "basic" | "conditional",
    description: "",
    keywords: "",
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);
  const [ai, setAi] = useState({
    prompt: "",
    kind: "basic" as "basic" | "conditional",
    keywords: "",
    description: "",
    asTitle: false,
  });
  const [aiGenerating, setAiGenerating] = useState(false);
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [titleUploading, setTitleUploading] = useState(false);
  // AI 생성 중인 필드 (scenario | greeting)
  const [generating, setGenerating] = useState<"scenario" | "greeting" | null>(null);

  const loadRels = () =>
    fetch(`/api/characters/${id}/relationships`).then((r) => r.json()).then(setRels);
  const loadIllusts = () =>
    fetch(`/api/characters/${id}/illustrations`).then((r) => r.json()).then(setIllusts);

  useEffect(() => {
    fetch(`/api/characters/${id}`)
      .then((r) => r.json())
      .then((c: Character) => {
        setChar(c);
        setAi((prev) => ({ ...prev, prompt: prev.prompt || defaultIllustPrompt(c) }));
        fetch(`/api/worlds/${c.world_id}/dictionary`)
          .then((r) => r.json())
          .then((list: DictOption[]) => setEntries(list.filter((d) => d.character_id == null)));
      });
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);
    loadRels();
    loadIllusts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!char) return <p>로딩 중...</p>;

  const save = async () => {
    await fetch(`/api/characters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(char),
    });
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

  const uploadTitleImage = async () => {
    if (!titleFile) return;
    setTitleUploading(true);
    const form = new FormData();
    form.append("file", titleFile);
    const res = await fetch(`/api/characters/${id}/title-image`, { method: "POST", body: form });
    setTitleUploading(false);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setChar({ ...char, title_image_url: r.url });
    setTitleFile(null);
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

  const doUpload = async () => {
    if (!upload.file) {
      alert("이미지 파일을 선택하세요.");
      return;
    }
    if (upload.kind === "conditional" && !upload.keywords.trim()) {
      alert("조건부 일러스트는 트리거 키워드가 필요합니다.");
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", upload.file);
    form.append("kind", upload.kind);
    form.append("description", upload.description);
    form.append("keywords", upload.keywords);
    const res = await fetch(`/api/characters/${id}/illustrations`, {
      method: "POST",
      body: form,
    });
    setUploading(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`업로드 실패: ${err.error ?? res.statusText}`);
      return;
    }
    setUpload({ kind: "basic", description: "", keywords: "", file: null });
    loadIllusts();
  };

  /** AI 일러스트 생성 → 성공 시 목록/타이틀 갱신 */
  const doAiGenerate = async () => {
    if (!ai.prompt.trim()) {
      alert("프롬프트를 입력하세요.");
      return;
    }
    if (!ai.asTitle && ai.kind === "conditional" && !ai.keywords.trim()) {
      alert("조건부 일러스트는 트리거 키워드가 필요합니다.");
      return;
    }
    setAiGenerating(true);
    try {
      const res = await fetch(`/api/characters/${id}/illustrations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ai),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`생성 실패: ${r.error ?? res.statusText}`);
        return;
      }
      if (ai.asTitle) setChar((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
      else loadIllusts();
      setAi((prev) => ({ ...prev, description: "", keywords: "" }));
    } finally {
      setAiGenerating(false);
    }
  };

  const removeIllust = async (illustId: number) => {
    if (!confirm("일러스트를 삭제할까요?")) return;
    await fetch(`/api/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  return (
    <>
      <h2>캐릭터 편집: {char.name}</h2>

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
      </div>

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
          </>
        )}
        <label>이미지 파일</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })}
        />
        <button onClick={doUpload} disabled={uploading}>
          {uploading ? "업로드 중..." : "업로드"}
        </button>
        <p className="muted" style={{ marginTop: 8 }}>
          업로드 대상(S3/FTP)은 설정 메뉴에서 지정합니다.
        </p>
      </div>

      <h3>AI 일러스트 생성</h3>
      <div className="panel">
        <label>프롬프트</label>
        <textarea rows={3} value={ai.prompt} onChange={(e) => setAi({ ...ai, prompt: e.target.value })} placeholder="생성할 이미지를 설명하세요" />
        <div className="row">
          <div>
            <label>종류</label>
            <select value={ai.kind} onChange={(e) => setAi({ ...ai, kind: e.target.value as "basic" | "conditional" })} disabled={ai.asTitle}>
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input value={ai.description} onChange={(e) => setAi({ ...ai, description: e.target.value })} />
          </div>
        </div>
        {ai.kind === "conditional" && !ai.asTitle && (
          <>
            <label>트리거 키워드 (쉼표 구분)</label>
            <input value={ai.keywords} onChange={(e) => setAi({ ...ai, keywords: e.target.value })} placeholder="예: 화남, 분노, 짜증" />
          </>
        )}
        <label>
          <input type="checkbox" checked={ai.asTitle} style={{ width: "auto", marginRight: 6 }}
            onChange={(e) => setAi({ ...ai, asTitle: e.target.checked })} />
          타이틀 이미지로 사용
        </label>
        <button onClick={doAiGenerate} disabled={aiGenerating}>
          {aiGenerating ? "생성 중... (최대 2분)" : "AI 일러스트 생성"}
        </button>
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
                <td className="muted">{triggerKeywords(i).join(", ")}</td>
                <td><button className="danger small" onClick={() => removeIllust(i.id)}>삭제</button></td>
              </tr>
            ))}
            {illusts.length === 0 && (
              <tr><td colSpan={5} className="muted">등록된 일러스트가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CharacterAnniversarySection characterId={id} />
    </>
  );
}
