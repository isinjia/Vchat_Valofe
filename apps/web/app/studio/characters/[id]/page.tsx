"use client";

import Link from "next/link";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import DictionaryBrowser from "../../components/DictionaryBrowser";
import ImageCropModal from "../../components/ImageCropModal";
import CharacterProfilesSection from "./CharacterProfilesSection";
import CharacterAnniversarySection from "./CharacterAnniversarySection";
import CharacterEventsSection from "./CharacterEventsSection";
import { studioFetch, jsonInit, aiCostLabel, type PricingInfo } from "../../studio-api";
import ImageGenModal, { type ImageGenPayload } from "../../components/ImageGenModal";
import { buildImagePrompt } from "../../components/imagePrompt";
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
  delete_scheduled_at?: string | null;
  /** 활성 제재(기간제 비공개) — 제작자 안내용 */
  sanction_until?: string | null;
  sanction_reason?: string | null;
}

interface WorldOpt {
  id: number;
  name: string;
  title_image_url?: string | null;
  owner_nickname?: string | null;
}

interface IllustTrigger {
  type: string;
  keywords?: string[];
  requireEventId?: number;
  requireTierId?: number;
  requireRelationship?: "lover" | "engaged" | "married";
  minAffinity?: number;
}

interface TierOpt {
  id: number;
  name: string;
  tier_rank: number;
}

const REL_REQ_LABEL = { lover: "연인 이상", engaged: "약혼 이상", married: "결혼" } as const;

interface Illust {
  id: number;
  kind: "basic" | "conditional";
  url: string;
  description: string | null;
  trigger_condition: IllustTrigger | string | null;
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

function parseTrigger(i: Illust): IllustTrigger {
  if (!i.trigger_condition) return { type: "keyword" };
  try {
    const t = typeof i.trigger_condition === "string" ? JSON.parse(i.trigger_condition) : i.trigger_condition;
    return t && typeof t === "object" ? t : { type: "keyword" };
  } catch {
    return { type: "keyword" };
  }
}

/** 게이트 조건 요약 (예: "연인 이상 · 호감도 50+ · 등급: 단골 이상") */
function triggerGateSummary(t: IllustTrigger, events: { id: number; name: string }[], tiers: TierOpt[]): string {
  const parts: string[] = [];
  if (t.requireEventId != null) parts.push(`이벤트: ${events.find((ev) => ev.id === t.requireEventId)?.name ?? `#${t.requireEventId}`}`);
  if (t.requireRelationship) parts.push(REL_REQ_LABEL[t.requireRelationship] ?? t.requireRelationship);
  if (typeof t.minAffinity === "number") parts.push(`호감도 ${t.minAffinity}+`);
  if (t.requireTierId != null) parts.push(`등급: ${tiers.find((x) => x.id === t.requireTierId)?.name ?? `#${t.requireTierId}`} 이상`);
  return parts.join(" · ");
}

/** 일러스트 패널 입력 (업로드/AI 생성 공용) */
const EMPTY_PANEL = {
  kind: "basic" as "basic" | "conditional",
  description: "",
  keywords: "",
  reqEvent: "",
  reqTier: "",
  reqRel: "",
  minAff: "",
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
  const [events, setEvents] = useState<{ id: number; name: string }[]>([]);
  const [tiers, setTiers] = useState<TierOpt[]>([]); // user 트랙 등급
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
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업
  const [illustCropOpen, setIllustCropOpen] = useState(false); // 일러스트 크롭 팝업
  const [panel, setPanel] = useState(EMPTY_PANEL); // 일러스트 패널 공용 입력 (업로드/AI 생성)
  const [illustCost, setIllustCost] = useState<number | null>(null);
  const [genModal, setGenModal] = useState<null | "illust" | "title">(null); // AI 이미지 생성 모달

  const loadIllusts = () =>
    studioFetch(`/api/studio/characters/${id}/illustrations`).then((r) => r.json()).then(setIllusts).catch(() => {});
  const loadEvents = () =>
    studioFetch(`/api/studio/characters/${id}/events`).then((r) => r.json()).then((d) => setEvents(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      }
    });
    studioFetch("/api/studio/worlds").then((r) => r.json()).then(setMine).catch(() => {});
    studioFetch("/api/studio/open-worlds").then((r) => r.json()).then(setOpen).catch(() => {});
    studioFetch("/api/studio/pricing").then((r) => r.json()).then((p) => { setPricing(p); setIllustCost(p.illustGenCost ?? null); }).catch(() => {});
    loadIllusts();
    loadRels();
    studioFetch("/api/studio/tiers").then((r) => r.json()).then((d) => setTiers(Array.isArray(d) ? d : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="container studio"><p className="empty">{error}</p></div>;
  if (!char) return <div className="container studio"><p className="muted-center">로딩 중...</p></div>;

  const costLabel = (kind: string) => aiCostLabel(pricing, kind);
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
      {generating === kind ? "생성 중..." : `AI로 생성${costLabel(kind)}`}
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

  /** 패널 공용 입력 검증 (업로드/AI 생성 공통). 문제 있으면 alert 후 false */
  const validatePanel = () => {
    if (panel.kind === "conditional") {
      const hasGate = !!panel.reqEvent || !!panel.reqTier || !!panel.reqRel || panel.minAff.trim() !== "";
      if (!panel.keywords.trim() && !hasGate) {
        alert("조건부 일러스트는 트리거 키워드 또는 조건(이벤트/등급/관계/호감도) 중 하나 이상이 필요합니다.");
        return false;
      }
      if (panel.minAff.trim() !== "") {
        const n = Number(panel.minAff);
        if (!Number.isInteger(n) || n < -100 || n > 100) {
          alert("호감도 최소는 -100~100 사이 정수여야 합니다.");
          return false;
        }
      }
    }
    return true;
  };

  /** 조건부일 때만 게이트 값을 서버로 보냄 (빈 값은 생략) */
  const gateFields = () =>
    panel.kind === "conditional"
      ? {
          requireEventId: panel.reqEvent || undefined,
          requireTierId: panel.reqTier || undefined,
          requireRelationship: panel.reqRel || undefined,
          minAffinity: panel.minAff.trim() !== "" ? panel.minAff.trim() : undefined,
        }
      : {};

  const openUpload = () => {
    if (validatePanel()) setIllustCropOpen(true);
  };

  const openAiGenerate = () => {
    if (validatePanel()) setGenModal("illust");
  };

  /** 크롭 팝업 확인 → 현재 패널 값과 함께 일러스트 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const doUpload = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("kind", panel.kind);
    form.append("description", panel.description);
    form.append("keywords", panel.kind === "conditional" ? panel.keywords : "");
    for (const [k, v] of Object.entries(gateFields())) if (v !== undefined) form.append(k, String(v));
    const res = await studioFetch(`/api/studio/characters/${id}/illustrations`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`업로드 실패: ${err.error ?? res.statusText}`);
    }
    setPanel(EMPTY_PANEL);
    loadIllusts();
  };

  /** 생성 모달 확인 → AI 일러스트/타이틀 생성 (실패 시 throw → 모달 안에 에러 표시) */
  const doAiGenerate = async (p: ImageGenPayload, asTitle: boolean) => {
    const res = await studioFetch(`/api/studio/characters/${id}/illustrations/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: p.prompt,
        kind: panel.kind,
        keywords: panel.kind === "conditional" ? panel.keywords : "",
        ...gateFields(),
        description: panel.description,
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
      setPanel(EMPTY_PANEL);
    }
  };

  const removeIllust = async (illustId: number) => {
    if (!confirm("일러스트를 삭제할까요?")) return;
    await studioFetch(`/api/studio/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  const removeChar = async () => {
    const input = prompt("삭제하려면 캐릭터 이름을 똑같이 입력하세요: " + char.name);
    if (input === null) return;
    const res = await studioFetch(`/api/studio/characters/${id}`, jsonInit("DELETE", { name: input }));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    alert("3일 후 삭제됩니다. 그 전까지 취소할 수 있습니다.");
    router.replace("/studio");
  };

  const cancelDelete = async () => {
    const res = await studioFetch(`/api/studio/characters/${id}`, jsonInit("DELETE", { cancel: true }));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 취소 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setChar((prev) => (prev ? { ...prev, delete_scheduled_at: null } : prev));
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
        <Link href="/studio" className="back-link" title="스튜디오로">‹</Link> 캐릭터 편집: {char.name}
      </h2>

      {char.delete_scheduled_at && (
        <div className="notice" style={{ borderColor: "#e5484d", color: "#e5484d" }}>
          이 캐릭터는 {new Date(char.delete_scheduled_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 에 삭제됩니다.{" "}
          <button type="button" className="small" onClick={cancelDelete}>삭제 취소</button>
        </div>
      )}

      {char.sanction_until && (
        <div className="notice" style={{ borderColor: "#e0a030", color: "#e0b050" }}>
          ⚠ 운영 제재로{" "}
          {new Date(char.sanction_until).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{" "}
          까지 비공개 상태입니다 (신규 대화 시작 불가, 기존 대화는 유지).
          {char.sanction_reason && <> 사유: {char.sanction_reason}</>}
        </div>
      )}

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
        <label>타이틀 이미지 (세로 3:4)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
          {char.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={char.title_image_url} alt="타이틀 이미지" className="title-img" style={{ width: 120 }} />
          ) : (
            <div className="title-img placeholder" style={{ width: 120 }} />
          )}
          <div>
            <button type="button" className="small" onClick={() => setTitleCropOpen(true)}>이미지 업로드</button>{" "}
            <button type="button" className="small" onClick={() => setGenModal("title")}>
              AI 생성{illustCost != null ? ` (-${illustCost.toLocaleString()}코인)` : ""}
            </button>
          </div>
        </div>
        <CharacterProfilesSection characterId={char.id} characterName={char.name} characterProfile={char.profile} titleImageUrl={char.title_image_url} genCost={illustCost} />

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

      <div style={{ display: tab === "event" ? undefined : "none" }}>
        <CharacterEventsSection characterId={id} onChanged={loadEvents} character={char} titleImageUrl={char.title_image_url} illusts={illusts} onIllustsChanged={loadIllusts} genCost={illustCost} />
      </div>

      <div style={{ display: tab === "illust" ? undefined : "none" }}>
      <h3>일러스트</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>종류</label>
            <select value={panel.kind} onChange={(e) => setPanel({ ...panel, kind: e.target.value as "basic" | "conditional" })}>
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input value={panel.description} onChange={(e) => setPanel({ ...panel, description: e.target.value })} />
          </div>
        </div>
        {panel.kind === "conditional" && (
          <>
            <label>트리거 키워드 (쉼표 구분 — 응답에 이 단어가 포함되면 노출)</label>
            <input value={panel.keywords} onChange={(e) => setPanel({ ...panel, keywords: e.target.value })} placeholder="예: 화남, 분노, 짜증" />
            <label>이벤트 달성 필요</label>
            <select value={panel.reqEvent} onChange={(e) => setPanel({ ...panel, reqEvent: e.target.value })}>
              <option value="">없음</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            <div className="row">
              <div>
                <label>유저 등급 이상</label>
                <select value={panel.reqTier} onChange={(e) => setPanel({ ...panel, reqTier: e.target.value })}>
                  <option value="">없음</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} (순위 {t.tier_rank})</option>
                  ))}
                </select>
              </div>
              <div>
                <label>관계 이상</label>
                <select value={panel.reqRel} onChange={(e) => setPanel({ ...panel, reqRel: e.target.value })}>
                  <option value="">없음</option>
                  <option value="lover">연인 이상</option>
                  <option value="engaged">약혼 이상</option>
                  <option value="married">결혼</option>
                </select>
              </div>
              <div>
                <label>호감도 최소 (-100~100)</label>
                <input
                  type="number"
                  min={-100}
                  max={100}
                  value={panel.minAff}
                  onChange={(e) => setPanel({ ...panel, minAff: e.target.value })}
                  placeholder="빈값=없음"
                />
              </div>
            </div>
            <div className="muted">지정한 조건을 모두 충족한 유저에게만 노출됩니다. 키워드 없이 조건만 지정하면 조건 충족 시 기본 로테이션에 포함됩니다.</div>
          </>
        )}
        <button type="button" onClick={openUpload}>업로드 (무료)</button>{" "}
        <button type="button" onClick={openAiGenerate}>
          {`AI 생성${illustCost != null ? ` (-${illustCost.toLocaleString()}코인)` : ""}`}
        </button>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>미리보기</th><th>종류</th><th>설명</th><th>트리거 / 조건</th><th></th></tr>
          </thead>
          <tbody>
            {illusts.map((i) => (
              <tr key={i.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><img src={i.url} alt={i.description ?? ""} className="thumb" /></td>
                <td><span className={`badge ${i.kind === "conditional" ? "cond" : ""}`}>{i.kind === "conditional" ? "조건부" : "기본"}</span></td>
                <td>{i.description}</td>
                <td className="muted">
                  {(parseTrigger(i).keywords ?? []).join(", ")}
                  {triggerGateSummary(parseTrigger(i), events, tiers) && (
                    <div>{triggerGateSummary(parseTrigger(i), events, tiers)}</div>
                  )}
                </td>
                <td><button className="danger small" onClick={() => removeIllust(i.id)}>삭제</button></td>
              </tr>
            ))}
            {illusts.length === 0 && <tr><td colSpan={5} className="muted">등록된 일러스트가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      </div>

      {/* 모달은 탭 컨테이너(display:none) 바깥 최상위에 렌더 — 어느 탭에서든 보이도록 */}
      <ImageCropModal
        open={titleCropOpen}
        title="타이틀 이미지 업로드"
        aspect={3 / 4}
        onCancel={() => setTitleCropOpen(false)}
        onConfirm={uploadTitleImage}
      />
      <ImageCropModal
        open={illustCropOpen}
        title="일러스트 업로드"
        aspect="free"
        onCancel={() => setIllustCropOpen(false)}
        onConfirm={doUpload}
      />
      <ImageGenModal
        open={genModal !== null}
        title={genModal === "title" ? "AI 타이틀 이미지 생성" : "AI 일러스트 생성"}
        initialPrompt={
          genModal === "title"
            ? buildImagePrompt(char, "세로형 3:4 타이틀 일러스트")
            : buildImagePrompt(char, panel.description, panel.kind === "conditional" ? panel.keywords : "")
        }
        titleImageUrl={char.title_image_url}
        submitSuffix={illustCost != null ? ` (-${illustCost.toLocaleString()}코인)` : ""}
        onClose={() => setGenModal(null)}
        onGenerate={(p) => doAiGenerate(p, genModal === "title")}
      />

      {!char.delete_scheduled_at && <button className="danger" onClick={removeChar}>캐릭터 삭제</button>}
    </div>
  );
}
