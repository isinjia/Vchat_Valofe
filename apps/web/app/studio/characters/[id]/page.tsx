"use client";

import Link from "next/link";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import CharacterAnniversarySection from "./CharacterAnniversarySection";
import { studioFetch, jsonInit } from "../../studio-api";

interface Character {
  id: number;
  world_id: number;
  name: string;
  profile: string;
  personality: string;
  speech_style: string;
  ai_prompt: string;
  scenario: string | null;
  greeting: string | null;
  visibility: "private" | "open";
  title_image_url?: string | null;
}

interface WorldOpt {
  id: number;
  name: string;
  owner_nickname?: string | null;
}

interface Illust {
  id: number;
  kind: "basic" | "conditional";
  url: string;
  description: string | null;
  trigger_condition: { type: string; keywords: string[] } | string | null;
}

interface DictOpt {
  id: number;
  title: string;
  category: "location" | "person" | "term";
}

interface Rel {
  id: number;
  target_entry_id: number;
  target_title: string;
  target_category: "location" | "person" | "term";
  relation: string;
}

function triggerKeywords(i: Illust): string[] {
  if (!i.trigger_condition) return [];
  const t = typeof i.trigger_condition === "string" ? JSON.parse(i.trigger_condition) : i.trigger_condition;
  return t.keywords ?? [];
}

/** AI 일러스트 기본 프롬프트: 캐릭터 이름 + 프로필 첫 문장 */
const defaultIllustPrompt = (c: { name: string; profile: string }) => {
  const first = (c.profile ?? "").split(/(?<=[.!?。])\s|\n/)[0]?.trim() ?? "";
  return `${c.name}, ${first} 세로형 캐릭터 일러스트, 고품질`.replace(/\s+/g, " ").trim();
};

type GenKind ="profile" | "personality" | "speech_style" | "scenario" | "greeting";

export default function StudioCharacterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [char, setChar] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<WorldOpt[]>([]);
  const [open, setOpen] = useState<WorldOpt[]>([]);
  const [illusts, setIllusts] = useState<Illust[]>([]);
  // 관계/기억: 대상 후보(세계관 공통 사전 항목), 등록된 관계, 입력값
  const [entries, setEntries] = useState<DictOpt[]>([]);
  const [rels, setRels] = useState<Rel[]>([]);
  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [newPerson, setNewPerson] = useState("");
  const [saved, setSaved] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [titleFile, setTitleFile] = useState<File | null>(null);
  const [titleUploading, setTitleUploading] = useState(false);
  const [upload, setUpload] = useState({
    kind: "basic" as "basic" | "conditional",
    description: "",
    keywords: "",
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);
  const [illustCost, setIllustCost] = useState<number | null>(null);
  const [ai, setAi] = useState({
    prompt: "",
    kind: "basic" as "basic" | "conditional",
    keywords: "",
    description: "",
    asTitle: false,
  });
  const [aiGenerating, setAiGenerating] = useState(false);

  const loadIllusts = () =>
    studioFetch(`/api/studio/characters/${id}/illustrations`).then((r) => r.json()).then(setIllusts).catch(() => {});

  const loadRels = () =>
    studioFetch(`/api/studio/characters/${id}/relationships`)
      .then((r) => r.json())
      .then((l) => setRels(Array.isArray(l) ? l : []))
      .catch(() => {});

  useEffect(() => {
    studioFetch(`/api/studio/characters/${id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error ?? "불러오기 실패");
      else {
        setChar(d);
        studioFetch(`/api/studio/worlds/${d.world_id}/entries`)
          .then((r) => r.json())
          .then((l) => setEntries(Array.isArray(l) ? l : []))
          .catch(() => {});
        setAi((prev) => ({ ...prev, prompt: prev.prompt || defaultIllustPrompt(d) }));
      }
    });
    studioFetch("/api/studio/worlds").then((r) => r.json()).then(setMine).catch(() => {});
    studioFetch("/api/studio/open-worlds").then((r) => r.json()).then(setOpen).catch(() => {});
    studioFetch("/api/studio/pricing").then((r) => r.json()).then((p) => { setCost(p.aiAssistCost); setIllustCost(p.illustGenCost ?? null); }).catch(() => {});
    loadIllusts();
    loadRels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="container studio"><p className="empty">{error}</p></div>;
  if (!char) return <div className="container studio"><p className="muted-center">로딩 중...</p></div>;

  const costLabel = cost != null ? ` (-${cost.toLocaleString()}코인)` : "";
  const myIds = new Set(mine.map((w) => w.id));
  const others = open.filter((w) => !myIds.has(w.id));
  const set = (patch: Partial<Character>) => setChar({ ...char, ...patch });

  const save = async () => {
    const res = await studioFetch(`/api/studio/characters/${id}`, jsonInit("PUT", char));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`저장 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // 내 세계관일 때만 새 인물 간단 등록 허용 (남의 오픈 세계관 사전에는 쓰기 금지)
  const isMyWorld = myIds.has(char.world_id);

  const addRel = async () => {
    if (!newRel.target || !newRel.relation.trim()) return;
    const res = await studioFetch(
      `/api/studio/characters/${id}/relationships`,
      jsonInit("POST", { target_entry_id: newRel.target, relation: newRel.relation })
    );
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`추가 실패: ${r.error ?? res.statusText}`);
      return;
    }
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
    const d = await studioFetch(
      `/api/studio/worlds/${char.world_id}/dictionary`,
      jsonInit("POST", { category: "person", title: name, content: name })
    );
    const dr = await d.json().catch(() => ({}));
    if (!d.ok) {
      alert(`인물 등록 실패: ${dr.error ?? d.statusText}`);
      return;
    }
    await studioFetch(
      `/api/studio/characters/${id}/relationships`,
      jsonInit("POST", { target_entry_id: dr.id, relation: newRel.relation })
    );
    setNewPerson("");
    setNewRel({ target: "", relation: "" });
    setEntries((prev) => [...prev, { id: dr.id, title: name, category: "person" }]);
    loadRels();
  };

  const removeRel = async (rid: number) => {
    await studioFetch(`/api/studio/relationships/${rid}`, { method: "DELETE" });
    loadRels();
  };

  /** AI 생성 → textarea state 에 채움 (저장은 저장 버튼) */
  const generate = async (kind: GenKind) => {
    setGenerating(kind);
    try {
      const res = await studioFetch(
        "/api/studio/generate",
        jsonInit("POST", {
          kind,
          characterId: Number(id),
          // 저장 전 편집 중인 값을 컨텍스트에 반영
          fields: {
            name: char.name,
            world_id: String(char.world_id),
            profile: char.profile,
            personality: char.personality,
            speech_style: char.speech_style,
            ai_prompt: char.ai_prompt,
            scenario: char.scenario ?? "",
            greeting: char.greeting ?? "",
          },
        })
      );
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`생성 실패: ${r.error ?? res.statusText}`);
        return;
      }
      setChar((prev) => (prev ? { ...prev, [kind]: r.text } : prev));
    } finally {
      setGenerating(null);
    }
  };

  const GenButton = ({ kind }: { kind: GenKind }) => (
    <button type="button" className="small" onClick={() => generate(kind)} disabled={generating !== null}>
      {generating === kind ? "생성 중..." : `AI로 생성${costLabel}`}
    </button>
  );

  const uploadTitleImage = async () => {
    if (!titleFile) return;
    setTitleUploading(true);
    const form = new FormData();
    form.append("file", titleFile);
    const res = await studioFetch(`/api/studio/characters/${id}/title-image`, { method: "POST", body: form });
    setTitleUploading(false);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setChar({ ...char, title_image_url: r.url });
    setTitleFile(null);
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
    const res = await studioFetch(`/api/studio/characters/${id}/illustrations`, { method: "POST", body: form });
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
      const res = await studioFetch(`/api/studio/characters/${id}/illustrations/generate`, jsonInit("POST", ai));
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
    await studioFetch(`/api/studio/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  const removeChar = async () => {
    if (!confirm("캐릭터를 삭제할까요? 대화 기록 등 관련 데이터도 함께 삭제될 수 있습니다.")) return;
    const res = await studioFetch(`/api/studio/characters/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    router.replace("/studio");
  };

  // 현재 선택된 세계관이 목록에 없으면(비공개 전환 등) 옵션이 사라지지 않도록 표시용 보충
  const currentMissing = !mine.some((w) => w.id === char.world_id) && !open.some((w) => w.id === char.world_id);

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" style={{ color: "var(--muted)" }}>‹</Link> 캐릭터 편집: {char.name}
      </h2>

      <div className="panel">
        <label>타이틀 이미지 (세로 3:4)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
          {char.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={char.title_image_url} alt="타이틀 이미지" className="title-img" style={{ width: 120 }} />
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

        <div className="row">
          <div>
            <label>이름</label>
            <input value={char.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label>세계관</label>
            <select value={char.world_id} onChange={(e) => set({ world_id: Number(e.target.value) })}>
              {currentMissing && <option value={char.world_id}>(현재 세계관 #{char.world_id})</option>}
              <optgroup label="내 세계관">
                {mine.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </optgroup>
              <optgroup label="공개된 세계관">
                {others.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.owner_nickname ? ` (by ${w.owner_nickname})` : ""}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        <label>캐릭터 설정(프로필) <GenButton kind="profile" /></label>
        <textarea rows={5} value={char.profile} onChange={(e) => set({ profile: e.target.value })} placeholder="출신, 외모, 배경 스토리 등" />

        <label>기본 성격 <GenButton kind="personality" /></label>
        <textarea rows={3} value={char.personality} onChange={(e) => set({ personality: e.target.value })} />

        <label>말투 <GenButton kind="speech_style" /></label>
        <textarea rows={3} value={char.speech_style} onChange={(e) => set({ speech_style: e.target.value })} placeholder="예: 존댓말, 특정 어미 사용, 자주 쓰는 감탄사 등" />

        <label>캐릭터별 세세한 프롬프트</label>
        <textarea rows={6} value={char.ai_prompt} onChange={(e) => set({ ai_prompt: e.target.value })} placeholder="이 캐릭터에게만 적용되는 상세 AI 지침" />

        <label>상황 설정 (대화 시작 배경) <GenButton kind="scenario" /></label>
        <textarea rows={4} value={char.scenario ?? ""} onChange={(e) => set({ scenario: e.target.value })} placeholder="예: 비 내리는 저녁, 길드 주점. 신입 모험가인 유저가 처음 찾아온 참이다." />

        <label>첫 인사말 (비우면 AI 가 자동 생성) <GenButton kind="greeting" /></label>
        <textarea rows={3} value={char.greeting ?? ""} onChange={(e) => set({ greeting: e.target.value })} placeholder="캐릭터가 대화 시작 시 먼저 건네는 말" />

        <label>공개 여부</label>
        <select value={char.visibility} onChange={(e) => set({ visibility: e.target.value as "private" | "open" })}>
          <option value="private">비공개 (나만 대화 가능)</option>
          <option value="open">공개</option>
        </select>
        <div className="notice">
          캐릭터는 소속 세계관도 공개 상태여야 메인 화면에 노출됩니다.
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
        {isMyWorld && (
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
        )}
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
            {rels.length === 0 && <tr><td className="muted">등록된 관계/기억이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>일러스트</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>종류</label>
            <select value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value as "basic" | "conditional" })}>
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input value={upload.description} onChange={(e) => setUpload({ ...upload, description: e.target.value })} />
          </div>
        </div>
        {upload.kind === "conditional" && (
          <>
            <label>트리거 키워드 (쉼표 구분 — 응답에 이 단어가 포함되면 노출)</label>
            <input value={upload.keywords} onChange={(e) => setUpload({ ...upload, keywords: e.target.value })} placeholder="예: 화남, 분노, 짜증" />
          </>
        )}
        <label>이미지 파일</label>
        <input type="file" accept="image/*" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} />
        <button onClick={doUpload} disabled={uploading}>{uploading ? "업로드 중..." : "업로드 (무료)"}</button>
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
          {aiGenerating ? "생성 중... (최대 2분)" : `AI 일러스트 생성${illustCost != null ? ` (-${illustCost.toLocaleString()}코인)` : ""}`}
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
                <td><span className={`badge ${i.kind === "conditional" ? "cond" : ""}`}>{i.kind === "conditional" ? "조건부" : "기본"}</span></td>
                <td>{i.description}</td>
                <td className="muted">{triggerKeywords(i).join(", ")}</td>
                <td><button className="danger small" onClick={() => removeIllust(i.id)}>삭제</button></td>
              </tr>
            ))}
            {illusts.length === 0 && <tr><td colSpan={5} className="muted">등록된 일러스트가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <CharacterAnniversarySection characterId={id} />

      <button className="danger" onClick={removeChar}>캐릭터 삭제</button>
    </div>
  );
}
