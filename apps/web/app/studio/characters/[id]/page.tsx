"use client";

import Link from "next/link";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import DictionaryBrowser from "../../components/DictionaryBrowser";
import ImageCropModal from "../../components/ImageCropModal";
import CharacterAnniversarySection from "./CharacterAnniversarySection";
import { studioFetch, jsonInit } from "../../studio-api";
import WorldPickerModal, { WorldMini, type PickedWorld } from "../../components/WorldPickerModal";

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
  title_image_url?: string | null;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  // 모달에서 선택한 세계관 (목록 조회 전/비공개 전환 케이스에도 표시되도록 별도 보관)
  const [pickedWorld, setPickedWorld] = useState<PickedWorld | null>(null);
  const [illusts, setIllusts] = useState<Illust[]>([]);
  // 관계/기억: 대상 후보(세계관 공통 사전 항목), 등록된 관계, 입력값
  const [entries, setEntries] = useState<DictOpt[]>([]);
  const [rels, setRels] = useState<Rel[]>([]);
  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [newPerson, setNewPerson] = useState("");
  // 전용 사전: 이 캐릭터만 아는 지식
  const [privKey, setPrivKey] = useState(0); // 전용 사전 목록 재조회 트리거
  const [newPriv, setNewPriv] = useState({ category: "term" as PrivEntry["category"], title: "", aliases: "", content: "" });
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("basic"); // 편집 탭
  const [cost, setCost] = useState<number | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업
  const [illustCropOpen, setIllustCropOpen] = useState(false); // 일러스트 크롭 팝업
  const [upload, setUpload] = useState({
    kind: "basic" as "basic" | "conditional",
    description: "",
    keywords: "",
  });
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

  const addPriv = async () => {
    if (!newPriv.title.trim()) return;
    const res = await studioFetch(
      `/api/studio/characters/${id}/dictionary`,
      jsonInit("POST", { ...newPriv, aliases: newPriv.aliases || null })
    );
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`추가 실패: ${r.error ?? res.statusText}`);
      return;
    }
    if (r.warning) alert(r.warning);
    setNewPriv({ ...newPriv, title: "", aliases: "", content: "" });
    setPrivKey((n) => n + 1);
  };

  const removePriv = async (did: number) => {
    if (!confirm("전용 사전 항목을 삭제할까요?")) return false;
    await studioFetch(`/api/studio/characters/${id}/dictionary/${did}`, { method: "DELETE" });
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

  /** 크롭 팝업 확인 → 타이틀 이미지 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const uploadTitleImage = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await studioFetch(`/api/studio/characters/${id}/title-image`, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    setChar((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
  };

  /** 업로드 버튼: 조건부인데 키워드가 비면 팝업 열기 전에 검증 */
  const openUpload = () => {
    if (upload.kind === "conditional" && !upload.keywords.trim()) {
      alert("조건부 일러스트는 트리거 키워드가 필요합니다.");
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
    const res = await studioFetch(`/api/studio/characters/${id}/illustrations`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`업로드 실패: ${err.error ?? res.statusText}`);
    }
    setUpload({ kind: "basic", description: "", keywords: "" });
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

  // 현재 세계관 표시용: 모달 선택값 > 내 세계관 > 오픈 세계관 > (목록에 없으면) 번호만 표시
  const curMine = mine.find((w) => w.id === char.world_id);
  const curOpen = open.find((w) => w.id === char.world_id);
  const currentWorld: PickedWorld =
    pickedWorld && pickedWorld.id === char.world_id
      ? pickedWorld
      : curMine
        ? { id: curMine.id, name: curMine.name, title_image_url: curMine.title_image_url ?? null, mine: true }
        : curOpen
          ? { id: curOpen.id, name: curOpen.name, title_image_url: curOpen.title_image_url ?? null, owner_nickname: curOpen.owner_nickname, mine: false }
          : { id: char.world_id, name: `현재 세계관 #${char.world_id}`, title_image_url: null, mine: false };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" style={{ color: "var(--muted)" }}>‹</Link> 캐릭터 편집: {char.name}
      </h2>

      {/* 탭 바: 비활성 탭도 언마운트하지 않고 display:none 으로만 숨겨 입력값/fetch 상태 보존 */}
      <div className="tabs">
        <button type="button" className={`tab ${tab === "basic" ? "active" : ""}`} onClick={() => setTab("basic")}>기본 설정</button>
        <button type="button" className={`tab ${tab === "rel" ? "active" : ""}`} onClick={() => setTab("rel")}>관계·기억·기념일</button>
        <button type="button" className={`tab ${tab === "dict" ? "active" : ""}`} onClick={() => setTab("dict")}>전용 사전</button>
        <button type="button" className={`tab ${tab === "illust" ? "active" : ""}`} onClick={() => setTab("illust")}>일러스트</button>
      </div>

      <div style={{ display: tab === "basic" ? undefined : "none" }}>
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
            <button type="button" className="small" onClick={() => setTitleCropOpen(true)}>이미지 업로드</button>
          </div>
        </div>
        <ImageCropModal
          open={titleCropOpen}
          title="타이틀 이미지 업로드"
          aspect={3 / 4}
          onCancel={() => setTitleCropOpen(false)}
          onConfirm={uploadTitleImage}
        />

        <div className="row">
          <div>
            <label>이름</label>
            <input value={char.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label>세계관</label>
            <div className="world-mini-row">
              <WorldMini world={currentWorld} />
              <button type="button" className="small ghost" onClick={() => setPickerOpen(true)}>변경</button>
            </div>
            <WorldPickerModal
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelect={(w) => { setPickedWorld(w); set({ world_id: w.id }); }}
            />
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
          baseUrl={`/api/studio/characters/${id}/dictionary`}
          category={cat}
          title={`전용 ${CATEGORY_LABEL[cat]}`}
          refreshKey={privKey}
          onDelete={removePriv}
          showEmbedding
        />
      ))}
      </div>

      <div style={{ display: tab === "illust" ? undefined : "none" }}>
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
<button onClick={openUpload}>이미지 선택·업로드 (무료)</button>
        <ImageCropModal
          open={illustCropOpen}
          title="일러스트 업로드"
          aspect="free"
          onCancel={() => setIllustCropOpen(false)}
          onConfirm={doUpload}
        />
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
      </div>

      <button className="danger" onClick={removeChar}>캐릭터 삭제</button>
    </div>
  );
}
