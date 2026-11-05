"use client";

import DictionaryBrowser from "../../components/DictionaryBrowser";
import DictSearchSelect from "../../components/DictSearchSelect";
import ImageCropModal from "../../components/ImageCropModal";
import ImageGenModal, { type ImageGenPayload } from "../../components/ImageGenModal";
import AiGenFlow, { GenVideoPreview } from "../../components/AiGenFlow";
import { buildImageDescription, buildProfileText } from "../../components/imagePrompt";
import { useEffect, useRef, useState, use } from "react";
import CharacterProfilesSection from "./CharacterProfilesSection";
import ProfileSetsSection from "./ProfileSetsSection";
import CharacterAnniversarySection from "./CharacterAnniversarySection";
import CharacterEventsSection from "./CharacterEventsSection";
import CharacterGiftsSection from "./CharacterGiftsSection";
import SanctionPanel from "../../components/SanctionPanel";
import { tintGradient } from "@/lib/tint";

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
  is_adult?: number;
  /** 세계관의 19금 여부 (서버 계산) — 1 이면 캐릭터는 자동 19금 */
  world_is_adult?: number;
  visibility?: "private" | "open";
  status?: "active" | "suspended";
  /** 1=크롬 내장 AI(무료 브라우저 레벨) 허용 */
  browser_llm_enabled?: number;
  /** 브라우저 AI 프로필 상태 (서버 계산): ready | stale(재생성 필요) | missing */
  compact_status?: "ready" | "stale" | "missing";
  title_image_url?: string | null;
  /** 타이틀 컬러(#rrggbb) — 카드/채팅 배경 톤. null = 세계관 색 따름 */
  title_color?: string | null;
  owner_user_id?: number | null;
  owner_nickname?: string | null;
}

interface WorldOption { id: number; name: string; title_color?: string | null; }
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

interface IllustTrigger {
  type: string;
  keywords?: string[];
  requireEventId?: number;
  requireTierId?: number;
  requireRelationship?: "lover" | "engaged" | "married";
  minAffinity?: number;
  requirePlaceId?: number;
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
  media_type?: "image" | "video";
  url: string;
  description: string | null;
  trigger_condition: IllustTrigger | string | null;
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
function triggerGateSummary(
  t: IllustTrigger,
  events: { id: number; name: string }[],
  tiers: TierOpt[],
  places: { id: number; title: string }[] = []
): string {
  const parts: string[] = [];
  if (t.requireEventId != null) parts.push(`이벤트: ${events.find((ev) => ev.id === t.requireEventId)?.name ?? `#${t.requireEventId}`}`);
  if (t.requireRelationship) parts.push(REL_REQ_LABEL[t.requireRelationship] ?? t.requireRelationship);
  if (typeof t.minAffinity === "number") parts.push(`호감도 ${t.minAffinity}+`);
  if (t.requireTierId != null) parts.push(`등급: ${tiers.find((x) => x.id === t.requireTierId)?.name ?? `#${t.requireTierId}`} 이상`);
  if (t.requirePlaceId != null) parts.push(`지역: ${places.find((x) => x.id === t.requirePlaceId)?.title ?? `#${t.requirePlaceId}`}`);
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
  reqPlace: "",
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
  const [tiers, setTiers] = useState<TierOpt[]>([]); // user 트랙 등급
  // 전용 사전: 이 캐릭터만 아는 지식
  const [privKey, setPrivKey] = useState(0); // 전용 사전 목록 재조회 트리거
  const [newPriv, setNewPriv] = useState({ category: "term" as PrivEntry["category"], title: "", aliases: "", content: "" });
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("basic"); // 편집 탭

  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [panel, setPanel] = useState(EMPTY_PANEL); // 일러스트 패널 공용 입력 (업로드/AI 생성)
  const [illustCropOpen, setIllustCropOpen] = useState(false); // 일러스트 크롭 팝업
  const [videoPreview, setVideoPreview] = useState<{ url: string; id: number } | null>(null); // 영상 생성 결과
  const videoFileRef = useRef<HTMLInputElement>(null); // 영상 업로드 파일 선택
  const [videoUploading, setVideoUploading] = useState(false);
  const [genModal, setGenModal] = useState<null | "illust" | "title" | "video">(null); // AI 이미지/영상 생성 모달
  // AI 생성 모달용 참조 자산 (타이틀/프로필/일러스트/지역/세계관 배경)
  const [genRefs, setGenRefs] = useState<{
    titleImageUrl: string | null;
    profiles: { id: number; emotion: string; url: string }[];
    illustrations: { id: number; url: string; description: string | null; media_type?: "image" | "video" }[];
    places: { id: number; title: string; content: string }[];
    worldIllustrations: { id: number; dict_entry_id: number | null; url: string; description: string | null; place_title?: string | null }[];
  } | null>(null);

  useEffect(() => {
    if (genModal === null) return;
    fetch(`/api/characters/${id}/gen-refs`)
      .then((r) => r.json())
      .then((d) => setGenRefs(d.error ? null : d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genModal, id]);
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업
  // AI 생성 중인 필드 (scenario | greeting)
  const [generating, setGenerating] = useState<"scenario" | "greeting" | null>(null);
  const [compactBusy, setCompactBusy] = useState(false); // 브라우저 AI 프로필 생성 중

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
    fetch("/api/tiers")
      .then((r) => r.json())
      .then((d) => setTiers(Array.isArray(d) ? d.filter((t: { track?: string }) => t.track === "user") : []))
      .catch(() => {});
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

  /** 패널 공용 입력 검증 (업로드/AI 생성 공통). 문제 있으면 alert 후 false */
  const validatePanel = () => {
    if (panel.kind === "conditional") {
      const hasGate = !!panel.reqEvent || !!panel.reqTier || !!panel.reqRel || panel.minAff.trim() !== "" || !!panel.reqPlace;
      if (!panel.keywords.trim() && !hasGate) {
        alert("조건부 일러스트는 트리거 키워드 또는 조건(이벤트/등급/관계/호감도/지역) 중 하나 이상이 필요합니다.");
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
          requirePlaceId: panel.reqPlace || undefined,
        }
      : {};

  const openUpload = () => {
    if (validatePanel()) setIllustCropOpen(true);
  };

  const openAiGenerate = () => {
    if (validatePanel()) setGenModal("illust");
  };

  const openVideoUpload = () => {
    if (validatePanel()) videoFileRef.current?.click();
  };

  const openAiVideo = () => {
    if (validatePanel()) setGenModal("video");
  };

  /** 크롭 팝업 확인 → 현재 패널 값과 함께 일러스트 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const doUpload = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("kind", panel.kind);
    form.append("description", panel.description);
    form.append("keywords", panel.kind === "conditional" ? panel.keywords : "");
    for (const [k, v] of Object.entries(gateFields())) if (v !== undefined) form.append(k, String(v));
    const res = await fetch(`/api/characters/${id}/illustrations`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`업로드 실패: ${err.error ?? res.statusText}`);
    }
    setPanel(EMPTY_PANEL);
    loadIllusts();
  };

  /** AI 생성 호출 (저장 안 함) — base64 결과를 dataURL 로 반환. 저장은 AiGenFlow 의 save 에서 */
  const generateImageCall = async (p: ImageGenPayload, asTitle: boolean): Promise<string> => {
    const res = await fetch(`/api/characters/${id}/illustrations/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: p.prompt,
        kind: panel.kind,
        keywords: panel.kind === "conditional" ? panel.keywords : "",
        ...gateFields(),
        asTitle,
        refTitleImage: p.refTitleImage,
        refImages: p.refImages,
        refProfileIds: p.refProfileIds,
        refIllustIds: p.refIllustIds,
        refWorldIllustIds: p.refWorldIllustIds,
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    return `data:${r.mime ?? "image/png"};base64,${r.image}`;
  };

  /** 영상 파일 선택 → 크롭 없이 바로 업로드 (mp4/webm) */
  const doUploadVideo = async (file: File | null) => {
    if (!file) return;
    if (!/^video\/(mp4|webm)$/.test(file.type)) {
      alert("mp4 또는 webm 영상만 업로드할 수 있습니다.");
      return;
    }
    setVideoUploading(true);
    try {
      await doUpload(file, file.name);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setVideoUploading(false);
    }
  };

  /** 생성 모달 확인 → AI 영상 생성 (영상은 즉시 등록 — 성공 시 프리뷰 모달에서 다운로드/등록취소) */
  const doAiGenerateVideo = async (p: ImageGenPayload) => {
    const res = await fetch(`/api/characters/${id}/illustrations/generate-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: p.prompt,
        kind: panel.kind,
        keywords: panel.kind === "conditional" ? panel.keywords : "",
        ...gateFields(),
        description: panel.description,
        refTitleImage: p.refTitleImage,
        refImages: p.refImages,
        refProfileIds: p.refProfileIds,
        refIllustIds: p.refIllustIds,
        refWorldIllustIds: p.refWorldIllustIds,
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    loadIllusts();
    setPanel(EMPTY_PANEL);
    setVideoPreview({ url: r.url, id: r.id });
  };

  const removeIllust = async (illustId: number) => {
    if (!confirm("일러스트를 삭제할까요?")) return;
    await fetch(`/api/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  // 편집 화면 배경 톤: 캐릭터 타이틀 컬러 → 없으면 세계관 타이틀 컬러
  const worldColor = worlds.find((w) => w.id === char.world_id)?.title_color ?? null;
  const pageTint = tintGradient(char.title_color ?? worldColor);

  return (
    <div className="page-tinted" style={pageTint ? { background: pageTint } : undefined}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        캐릭터 편집: {char.name}
        <a href={`/api/characters/${char.id}/export`} download>
          <button type="button" className="small btn-secondary">JSON 내보내기</button>
        </a>
        <a href={`/characters/${char.id}/stories`}>
          <button type="button" className="small btn-secondary">스토리 모드</button>
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
        <button type="button" className={`tab ${tab === "prof" ? "active" : ""}`} onClick={() => setTab("prof")}>프로필</button>
        <button type="button" className={`tab ${tab === "rel" ? "active" : ""}`} onClick={() => setTab("rel")}>관계·기억·기념일</button>
        <button type="button" className={`tab ${tab === "dict" ? "active" : ""}`} onClick={() => setTab("dict")}>전용 사전</button>
        <button type="button" className={`tab ${tab === "event" ? "active" : ""}`} onClick={() => setTab("event")}>이벤트</button>
        <button type="button" className={`tab ${tab === "illust" ? "active" : ""}`} onClick={() => setTab("illust")}>일러스트</button>
        <button type="button" className={`tab ${tab === "gift" ? "active" : ""}`} onClick={() => setTab("gift")}>선물</button>
      </div>

      <div style={{ display: tab === "gift" ? undefined : "none" }}>
        <CharacterGiftsSection characterId={id} />
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
        </div>
        <div className="row">
          <div>
            <label>이름</label>
            <input value={char.name} onChange={(e) => setChar({ ...char, name: e.target.value })} />
          </div>
          <div>
            <label>세계관</label>
            {/* 사전/관계/기념일이 세계관에 묶여 있어 변경 불가 */}
            <input
              value={worlds.find((w) => w.id === char.world_id)?.name ?? `#${char.world_id}`}
              disabled
              title="캐릭터의 세계관은 변경할 수 없습니다"
            />
          </div>
        </div>

        <label>타이틀 컬러</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input
            type="color"
            value={char.title_color ?? worldColor ?? "#7c8cf8"}
            onChange={(e) => setChar({ ...char, title_color: e.target.value })}
            style={{ width: 44, height: 32, padding: 2, cursor: "pointer" }}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {char.title_color ?? `세계관 색 따름${worldColor ? ` (${worldColor})` : " (미지정)"}`} — 카드 테두리와 채팅 배경 톤에 쓰입니다.
          </span>
          {char.title_color && (
            <button type="button" className="small ghost" onClick={() => setChar({ ...char, title_color: null })}>
              세계관 색 따르기
            </button>
          )}
        </div>
        <label
          title={
            char.world_is_adult === 1
              ? "세계관이 19금이라 이 캐릭터는 자동으로 19금입니다"
              : "체크하면 이 캐릭터와 소속 스토리에 성인용 대화 허용이 적용됩니다"
          }
        >
          <input
            type="checkbox"
            checked={char.world_is_adult === 1 || char.is_adult === 1}
            disabled={char.world_is_adult === 1}
            onChange={(e) => setChar({ ...char, is_adult: e.target.checked ? 1 : 0 })}
            style={{ width: "auto", marginRight: 6 }}
          />
          🔞 19금 캐릭터 (소속 스토리 자동 19금)
          {char.world_is_adult === 1 && <span className="muted"> — 세계관이 19금이라 자동 적용</span>}
        </label>
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
        <label>
          <input
            type="checkbox"
            checked={!!char.browser_llm_enabled}
            onChange={(e) => setChar({ ...char, browser_llm_enabled: e.target.checked ? 1 : 0 })}
            style={{ width: "auto", marginRight: 6 }}
          />
          크롬 내장 AI 허용 (무료 브라우저 레벨)
        </label>
        <div className="notice">
          허용 시 전용 프로필 생성이 한 번 필요합니다 — 버튼을 누르면 설정 길이에 따라 그대로 캐싱 또는
          AI 압축을 자동 선택합니다(관리자는 코인 차감 없음). 생성은 저장된 설정 기준이며, 설정을 바꾸면
          &quot;재생성 필요&quot;로 표시되지만 자동으로 다시 만들지는 않습니다.
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span>
              {char.compact_status === "ready" && "브라우저 AI 프로필 준비됨 (최신 상태)."}
              {char.compact_status === "stale" && "⚠ 설정이 변경되어 재생성이 필요합니다."}
              {char.compact_status === "missing" && "브라우저 AI 프로필이 없습니다 — 생성해야 사용할 수 있습니다."}
            </span>
            {(char.compact_status === "stale" || char.compact_status === "missing") && (
              <button
                type="button"
                disabled={compactBusy}
                onClick={async () => {
                  setCompactBusy(true);
                  try {
                    const res = await fetch(`/api/characters/${id}/compact`, { method: "POST" });
                    const r = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      alert(`생성 실패: ${r.error ?? res.statusText}`);
                      return;
                    }
                    setChar({ ...char, compact_status: "ready" });
                    alert(r.method === "cached" ? "설정이 짧아 그대로 캐싱했습니다." : "AI 압축으로 생성했습니다.");
                  } finally {
                    setCompactBusy(false);
                  }
                }}
              >
                {compactBusy ? "생성 중..." : char.compact_status === "stale" ? "프로필 재생성" : "프로필 생성"}
              </button>
            )}
          </div>
        </div>
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

      <div style={{ display: tab === "prof" ? undefined : "none" }}>
        <h3>프로필 이미지</h3>
        <div className="panel">
          <CharacterProfilesSection characterId={char.id} characterName={char.name} characterProfile={char.profile} titleImageUrl={char.title_image_url} />
        </div>
        <ProfileSetsSection
          characterId={id}
          characterName={char.name}
          characterProfile={char.profile}
          titleImageUrl={char.title_image_url}
          genCost={null}
          effectMaxMb={null}
        />
      </div>

      <div style={{ display: tab === "rel" ? undefined : "none" }}>
      <h3>인물·장소와의 관계/기억</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>세계관 사전에서 선택 (인물·지역·용어)</label>
            <DictSearchSelect
              entries={entries}
              value={newRel.target}
              onChange={(id) => setNewRel({ ...newRel, target: id })}
            />
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
        <CharacterEventsSection characterId={id} onChanged={loadEvents} character={char} titleImageUrl={char.title_image_url} illusts={illusts} onIllustsChanged={loadIllusts} />
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
              <div>
                <label>현재 지역 (지역사전)</label>
                <select value={panel.reqPlace} onChange={(e) => setPanel({ ...panel, reqPlace: e.target.value })}>
                  <option value="">없음</option>
                  {entries.filter((en) => en.category === "location").map((en) => (
                    <option key={en.id} value={en.id}>{en.title}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="muted">지정한 조건을 모두 충족한 유저에게만 노출됩니다. 키워드 없이 조건만 지정하면 조건 충족 시 기본 로테이션에 포함됩니다.</div>
          </>
        )}
        <button type="button" onClick={openUpload}>업로드</button>{" "}
        <button type="button" onClick={openAiGenerate}>
          {`AI 생성`}
        </button>{" "}
        <button type="button" onClick={openVideoUpload} disabled={videoUploading}>
          {videoUploading ? "영상 업로드 중..." : "영상 업로드"}
        </button>{" "}
        <button type="button" onClick={openAiVideo}>AI 영상 생성</button>
        <input
          ref={videoFileRef}
          type="file"
          accept="video/mp4,video/webm"
          style={{ display: "none" }}
          onChange={(e) => {
            doUploadVideo(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <p className="muted" style={{ marginTop: 8 }}>
          업로드 대상(S3/FTP)은 설정 메뉴에서 지정합니다.
        </p>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>미리보기</th><th>종류</th><th>설명</th><th>트리거 / 조건</th><th></th></tr>
          </thead>
          <tbody>
            {illusts.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.media_type === "video" ? (
                    <video src={i.url} className="thumb" muted loop playsInline autoPlay />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.url} alt={i.description ?? ""} className="thumb" />
                  )}
                </td>
                <td>
                  <span className={`badge ${i.kind === "conditional" ? "cond" : ""}`}>
                    {i.kind === "conditional" ? "조건부" : "기본"}
                  </span>
                  {i.media_type === "video" && <div><span className="badge">영상</span></div>}
                </td>
                <td>{i.description}</td>
                <td className="muted">
                  {(parseTrigger(i).keywords ?? []).join(", ")}
                  {triggerGateSummary(parseTrigger(i), events, tiers, entries) && (
                    <div>{triggerGateSummary(parseTrigger(i), events, tiers, entries)}</div>
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
      {/* 이미지 생성: 생성 → 후보 선택/재생성 → 크롭/업로드 플로우 */}
      <AiGenFlow
        open={genModal === "illust" || genModal === "title"}
        title={genModal === "title" ? "AI 타이틀 이미지 생성" : "AI 일러스트 생성"}
        initialDescription={
          genModal === "title"
            ? "세로형 3:4 타이틀 일러스트"
            : buildImageDescription(panel.description, panel.kind === "conditional" ? panel.keywords : "")
        }
        initialProfile={buildProfileText(char)}
        places={genRefs?.places}
        assets={genRefs ?? undefined}
        titleImageUrl={char.title_image_url}
        aspect={genModal === "title" ? 3 / 4 : "free"}
        generate={(p) => generateImageCall(p, genModal === "title")}
        save={async (blob, filename) => {
          if (genModal === "title") await uploadTitleImage(blob, filename);
          else await doUpload(blob, filename);
        }}
        onClose={() => setGenModal(null)}
      />
      {/* 영상 생성: 입력 모달 + 결과 프리뷰(다운로드/등록취소) */}
      <ImageGenModal
        open={genModal === "video"}
        title="AI 영상 일러스트 생성"
        initialDescription={buildImageDescription(panel.description, panel.kind === "conditional" ? panel.keywords : "")}
        initialProfile={buildProfileText(char)}
        places={genRefs?.places}
        assets={genRefs ?? undefined}
        titleImageUrl={char.title_image_url}
        video
        onClose={() => setGenModal(null)}
        onGenerate={doAiGenerateVideo}
      />
      <GenVideoPreview
        open={videoPreview !== null}
        url={videoPreview?.url ?? null}
        onDiscard={async () => {
          if (!videoPreview) return;
          const res = await fetch(`/api/illustrations/${videoPreview.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("등록 취소에 실패했습니다.");
          loadIllusts();
        }}
        onClose={() => setVideoPreview(null)}
      />
    </div>
  );
}
