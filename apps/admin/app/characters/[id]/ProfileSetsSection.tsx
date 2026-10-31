"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { type ImageGenPayload } from "../../components/ImageGenModal";
import AiGenFlow from "../../components/AiGenFlow";
import ChromaKeyModal from "../../components/ChromaKeyModal";

/**
 * 고급 프로필(프로필 세트): 배경/얼굴/효과 3카테고리 세트를 조건(계절·기념일 전후·호감도·감정)으로
 * 관리한다. 고급 프로필 토글이 꺼져 있으면 기존 기본 프로필만 사용되고 이 UI 는 숨겨진다.
 */

const EMOTIONS: { key: string; label: string }[] = [
  { key: "default", label: "기본" },
  { key: "joy", label: "기쁨" },
  { key: "sad", label: "슬픔" },
  { key: "angry", label: "화남" },
  { key: "shy", label: "부끄러움" },
  { key: "surprised", label: "놀람" },
  { key: "love", label: "애정" },
  { key: "neutral", label: "평온" },
];

const SEASONS: [string, string][] = [
  ["spring", "봄 (3~5월)"],
  ["summer", "여름 (6~8월)"],
  ["autumn", "가을 (9~11월)"],
  ["winter", "겨울 (12~2월)"],
];

const CAT_LABEL = { background: "배경세트", face: "얼굴세트", effect: "효과세트" } as const;
type Category = keyof typeof CAT_LABEL;

/** 투명 이미지 확인용 체커보드 배경 */
const CHECKER: CSSProperties = {
  background: "repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 / 14px 14px",
};

interface SetItem {
  id: number;
  emotion: string;
  url: string;
}

interface PSet {
  id: number;
  category: Category;
  name: string;
  season: string | null;
  anniversary_id: number | null;
  anniversary_name?: string | null;
  days_before: number;
  days_after: number;
  min_affinity: number | null;
  emotion: string | null;
  bg_rule: { mode: string; ids: number[] } | string | null;
  url: string | null;
  effect_scale: number | string;
  effect_x: number | string;
  effect_y: number | string;
  items: SetItem[];
}

interface Anniv {
  id: number;
  name: string;
  month: number;
  day: number;
  character_id: number | null;
}

interface CondState {
  name: string;
  season: string;
  anniversaryId: string;
  daysBefore: string;
  daysAfter: string;
  minAffinity: string;
  emotion: string;
  bgMode: "all" | "allow" | "deny";
  bgIds: number[];
}

const EMPTY_COND: CondState = {
  name: "",
  season: "",
  anniversaryId: "",
  daysBefore: "0",
  daysAfter: "0",
  minAffinity: "",
  emotion: "",
  bgMode: "all",
  bgIds: [],
};

/** bg_rule(JSON 또는 객체) 해석 */
function ruleOf(s: PSet): { mode: "all" | "allow" | "deny"; ids: number[] } {
  if (!s.bg_rule) return { mode: "all", ids: [] };
  try {
    const r = typeof s.bg_rule === "string" ? JSON.parse(s.bg_rule) : s.bg_rule;
    if (r?.mode === "allow" || r?.mode === "deny") {
      return { mode: r.mode, ids: Array.isArray(r.ids) ? r.ids.map(Number) : [] };
    }
  } catch {
    // 무시
  }
  return { mode: "all", ids: [] };
}

function condStateOf(s: PSet): CondState {
  const r = ruleOf(s);
  return {
    name: s.name,
    season: s.season ?? "",
    anniversaryId: s.anniversary_id != null ? String(s.anniversary_id) : "",
    daysBefore: String(s.days_before ?? 0),
    daysAfter: String(s.days_after ?? 0),
    minAffinity: s.min_affinity != null ? String(s.min_affinity) : "",
    emotion: s.emotion ?? "",
    bgMode: r.mode,
    bgIds: r.ids,
  };
}

function condPayload(c: CondState) {
  return {
    name: c.name,
    season: c.season || undefined,
    anniversaryId: c.anniversaryId || undefined,
    daysBefore: c.daysBefore,
    daysAfter: c.daysAfter,
    minAffinity: c.minAffinity || undefined,
    emotion: c.emotion || undefined,
    bgMode: c.bgMode,
    bgIds: c.bgIds,
  };
}

/** 조건 요약 문구 */
function condSummary(s: PSet): string {
  const parts: string[] = [];
  if (s.season) parts.push(SEASONS.find(([k]) => k === s.season)?.[1] ?? s.season);
  if (s.anniversary_id != null) {
    const range =
      (Number(s.days_before) > 0 ? `${s.days_before}일 전` : "") +
      (Number(s.days_before) > 0 || Number(s.days_after) > 0 ? "~" : "") +
      (Number(s.days_after) > 0 ? `${s.days_after}일 후` : "");
    parts.push(`기념일: ${s.anniversary_name ?? `#${s.anniversary_id}`}${range ? ` (${range})` : ""}`);
  }
  if (s.min_affinity != null) parts.push(`호감도 ${s.min_affinity}+`);
  if (s.emotion) parts.push(`감정: ${EMOTIONS.find((e) => e.key === s.emotion)?.label ?? s.emotion}`);
  if (s.category === "face") {
    const r = ruleOf(s);
    if (r.mode === "allow") parts.push(`허용 배경 ${r.ids.length}개`);
    if (r.mode === "deny") parts.push(`차단 배경 ${r.ids.length}개`);
  }
  return parts.length ? parts.join(" · ") : "조건 없음 (항상 적용)";
}

/** 조건 입력 폼 (생성/수정 공용) */
function CondForm({
  cat,
  value,
  onChange,
  annivs,
  bgSets,
  submitLabel,
  onSubmit,
  onCancel,
  error,
}: {
  cat: Category;
  value: CondState;
  onChange: (v: CondState) => void;
  annivs: Anniv[];
  bgSets: PSet[];
  submitLabel: string;
  onSubmit: () => void;
  onCancel?: () => void;
  error: string;
}) {
  const set = (patch: Partial<CondState>) => onChange({ ...value, ...patch });
  const toggleBg = (id: number) =>
    set({ bgIds: value.bgIds.includes(id) ? value.bgIds.filter((x) => x !== id) : [...value.bgIds, id] });
  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div className="row">
        <div>
          <label>세트 이름</label>
          <input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 겨울 교복, 크리스마스" />
        </div>
        <div>
          <label>계절 조건</label>
          <select value={value.season} onChange={(e) => set({ season: e.target.value })}>
            <option value="">없음</option>
            {SEASONS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label>호감도 조건 (이 값 이상)</label>
          <input type="number" min={-100} max={100} value={value.minAffinity} placeholder="빈값=없음"
            onChange={(e) => set({ minAffinity: e.target.value })} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>기념일 조건</label>
          <select value={value.anniversaryId} onChange={(e) => set({ anniversaryId: e.target.value })}>
            <option value="">없음</option>
            {annivs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({String(a.month).padStart(2, "0")}-{String(a.day).padStart(2, "0")}){a.character_id != null ? " · 개인" : ""}
              </option>
            ))}
          </select>
        </div>
        {value.anniversaryId && (
          <>
            <div>
              <label>시작 N일 전부터</label>
              <input type="number" min={0} max={60} value={value.daysBefore} onChange={(e) => set({ daysBefore: e.target.value })} />
            </div>
            <div>
              <label>종료 N일 후까지</label>
              <input type="number" min={0} max={60} value={value.daysAfter} onChange={(e) => set({ daysAfter: e.target.value })} />
            </div>
          </>
        )}
        {cat === "effect" && (
          <div>
            <label>감정 조건</label>
            <select value={value.emotion} onChange={(e) => set({ emotion: e.target.value })}>
              <option value="">없음</option>
              {EMOTIONS.map((e2) => (
                <option key={e2.key} value={e2.key}>{e2.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {cat === "face" && (
        <>
          <label>배경 호환 (의상·분위기가 안 맞는 배경 제외)</label>
          <select value={value.bgMode} onChange={(e) => set({ bgMode: e.target.value as CondState["bgMode"], bgIds: [] })}>
            <option value="all">모든 배경 허용 (기본)</option>
            <option value="allow">선택한 배경만 허용</option>
            <option value="deny">선택한 배경 차단</option>
          </select>
          {value.bgMode !== "all" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              {bgSets.map((b) => (
                <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                  <input type="checkbox" style={{ width: "auto", margin: 0 }}
                    checked={value.bgIds.includes(b.id)} onChange={() => toggleBg(b.id)} />
                  {b.name}
                </label>
              ))}
              {bgSets.length === 0 && <span className="muted">배경세트가 아직 없습니다.</span>}
            </div>
          )}
        </>
      )}
      {cat === "effect" && (
        <p className="muted" style={{ fontSize: 13 }}>효과세트는 조건이 하나 이상 필요합니다 (기본은 효과 없음).</p>
      )}
      {error && <p style={{ color: "var(--danger, #e5484d)", marginTop: 8 }}>{error}</p>}
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={onSubmit}>{submitLabel}</button>{" "}
        {onCancel && (
          <button type="button" className="small btn-secondary" onClick={onCancel}>취소</button>
        )}
      </div>
    </div>
  );
}

/** 효과 배치 편집기: 배경+얼굴은 고정, 효과만 드래그 이동/슬라이더 줌 */
function EffectEditor({
  set,
  bgUrl,
  faceUrl,
  onSave,
}: {
  set: PSet;
  bgUrl: string | null;
  faceUrl: string | null;
  onSave: (scale: number, x: number, y: number) => Promise<void>;
}) {
  const BOX = 260; // 편집 영역(px)
  const D = 130; // 프리뷰 원 지름(px) — 저장값은 지름=1 기준 비율
  const [scale, setScale] = useState(Number(set.effect_scale) || 1);
  const [x, setX] = useState(Number(set.effect_x) || 0);
  const [y, setY] = useState(Number(set.effect_y) || 0);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, x, y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setX(Math.max(-2, Math.min(2, drag.current.x + (e.clientX - drag.current.px) / D)));
    setY(Math.max(-2, Math.min(2, drag.current.y + (e.clientY - drag.current.py) / D)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          width: BOX,
          height: BOX,
          position: "relative",
          overflow: "hidden",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--bg, #15151a)",
          touchAction: "none",
          userSelect: "none",
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* 고정 프리뷰: 원형 배경+얼굴 (줌/이동 불가) */}
        <span
          style={{
            position: "absolute",
            left: (BOX - D) / 2,
            top: (BOX - D) / 2,
            width: D,
            height: D,
            borderRadius: "50%",
            overflow: "hidden",
            border: "1px solid var(--border)",
            background: "var(--panel)",
          }}
        >
          {bgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          )}
          {faceUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={faceUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </span>
        {set.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={set.url}
            alt=""
            draggable={false}
            onPointerDown={onPointerDown}
            style={{
              position: "absolute",
              left: BOX / 2 + x * D,
              top: BOX / 2 + y * D,
              width: scale * D,
              transform: "translate(-50%, -50%)",
              cursor: "grab",
              maxWidth: "none",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, maxWidth: BOX }}>
        <span style={{ fontSize: 13, whiteSpace: "nowrap" }}>크기 {scale.toFixed(2)}×</span>
        <input type="range" min={0.2} max={4} step={0.05} value={scale} style={{ flex: 1 }}
          onChange={(e) => setScale(Number(e.target.value))} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
        효과를 드래그해 위치를, 슬라이더로 크기를 조절하세요. 뒤의 배경·얼굴은 고정 프리뷰입니다.
      </p>
      <button
        type="button"
        className="small"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(scale, x, y);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "저장 중..." : "배치 저장"}
      </button>
    </div>
  );
}

export default function ProfileSetsSection({
  characterId,
  characterName,
  characterProfile,
  titleImageUrl,
  genCost,
  effectMaxMb,
}: {
  characterId: number | string;
  characterName: string;
  characterProfile: string;
  titleImageUrl?: string | null;
  genCost?: number | null;
  effectMaxMb?: number | null;
}) {
  const base = `/api/characters/${characterId}/profile-sets`;
  const [enabled, setEnabled] = useState(false);
  const [sets, setSets] = useState<PSet[]>([]);
  const [annivs, setAnnivs] = useState<Anniv[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 생성 폼 (카테고리별 열림 상태 + 입력)
  const [createCat, setCreateCat] = useState<Category | null>(null);
  const [createCond, setCreateCond] = useState<CondState>(EMPTY_COND);
  const [createErr, setCreateErr] = useState("");
  // 조건 수정
  const [editId, setEditId] = useState<number | null>(null);
  const [editCond, setEditCond] = useState<CondState>(EMPTY_COND);
  const [editErr, setEditErr] = useState("");
  // 파일 업로드 대상 (배경/효과 세트 이미지 or 얼굴 감정 슬롯)
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ setId: number; emotion?: string; effect?: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  // AI 얼굴 생성 / 색 지우개
  const [genTarget, setGenTarget] = useState<{ set: PSet; emotion: string } | null>(null);
  const [chromaTarget, setChromaTarget] = useState<{ set: PSet; item: SetItem } | null>(null);
  // 효과 배치 편집 토글
  const [effectEditId, setEffectEditId] = useState<number | null>(null);

  const load = async () => {
    const res = await fetch(base);
    if (!res.ok) return;
    const d = await res.json();
    setEnabled(!!d.enabled);
    setSets(Array.isArray(d.sets) ? d.sets : []);
    setAnnivs(Array.isArray(d.anniversaries) ? d.anniversaries : []);
    setLoaded(true);
  };
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const toggle = async (on: boolean) => {
    setEnabled(on); // 낙관적 갱신
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    if (!res.ok) setEnabled(!on);
  };

  const bgSets = sets.filter((s) => s.category === "background");

  const create = async (cat: Category) => {
    setCreateErr("");
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat, ...condPayload(createCond) }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCreateErr(r.error ?? "생성 실패");
      return;
    }
    setCreateCat(null);
    setCreateCond(EMPTY_COND);
    load();
  };

  const saveCond = async (s: PSet) => {
    setEditErr("");
    const res = await fetch(`${base}/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(condPayload(editCond)),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEditErr(r.error ?? "저장 실패");
      return;
    }
    setEditId(null);
    load();
  };

  const removeSet = async (s: PSet) => {
    if (!confirm(`"${s.name}" 세트를 삭제할까요? 등록된 이미지도 함께 삭제됩니다.`)) return;
    await fetch(`${base}/${s.id}`, { method: "DELETE" });
    load();
  };

  /** 효과 배치 저장: 현재 조건 그대로 + 배치값 */
  const saveTransform = async (s: PSet, scale: number, x: number, y: number) => {
    const res = await fetch(`${base}/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...condPayload(condStateOf(s)), effectScale: scale, effectX: x, effectY: y }),
    });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`저장 실패: ${r.error ?? res.statusText}`);
      return;
    }
    load();
  };

  const pickFile = (target: { setId: number; emotion?: string; effect?: boolean }) => {
    uploadTarget.current = target;
    fileRef.current?.click();
  };

  const onFile = async (file: File | null) => {
    const target = uploadTarget.current;
    uploadTarget.current = null;
    if (!file || !target) return;
    setMsg("");
    if (!file.type.startsWith("image/")) {
      setMsg("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (target.effect && effectMaxMb != null && file.size > effectMaxMb * 1024 * 1024) {
      setMsg(`효과 이미지는 ${effectMaxMb}MB 이하여야 합니다.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    let url = `${base}/${target.setId}/image`;
    if (target.emotion) {
      form.append("emotion", target.emotion);
      url = `${base}/${target.setId}/items`;
    }
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      setMsg(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    load();
  };

  /** 색 지우개 적용 결과 업로드 */
  const applyChroma = async (blob: Blob) => {
    if (!chromaTarget) return;
    const form = new FormData();
    form.append("file", blob, "transparent.png");
    form.append("emotion", chromaTarget.item.emotion);
    const res = await fetch(`${base}/${chromaTarget.set.id}/items`, { method: "POST", body: form });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      throw new Error(r.error ?? res.statusText);
    }
    load();
  };

  const removeItem = async (s: PSet, it: SetItem) => {
    if (!confirm("이 감정 이미지를 삭제할까요?")) return;
    await fetch(`${base}/${s.id}/items/${it.id}`, { method: "DELETE" });
    load();
  };

  /** AI 얼굴 생성 (저장 안 함) — dataURL 반환. 저장은 saveGeneratedFace 에서 items 업로드로 */
  const generateFace = async (p: ImageGenPayload): Promise<string> => {
    if (!genTarget) throw new Error("대상 슬롯이 없습니다.");
    const res = await fetch(`${base}/${genTarget.set.id}/items/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emotion: genTarget.emotion,
        prompt: p.prompt,
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

  /** 선택한 생성 결과를 얼굴세트 감정 슬롯에 업로드 */
  const saveGeneratedFace = async (blob: Blob, filename: string) => {
    if (!genTarget) return;
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("emotion", genTarget.emotion);
    const res = await fetch(`${base}/${genTarget.set.id}/items`, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    load();
  };

  /** 효과 편집 프리뷰용: 첫 배경세트 이미지 + 얼굴(세트 default → 없으면 null) */
  const previewBg = bgSets.find((b) => b.url)?.url ?? null;
  const previewFace =
    sets.find((s) => s.category === "face" && s.items.some((i) => i.emotion === "default"))?.items.find((i) => i.emotion === "default")?.url ?? null;

  const catDesc: Record<Category, string> = {
    background: "원형 아바타의 맨 아래에 깔리는 배경입니다. 세트당 이미지 1장.",
    face: "배경 위에 올라가는 인물(표정) 이미지입니다. 감정별로 등록하고, 투명배경 PNG 를 권장합니다.",
    effect: `원형보다 크게 덮이는 오버레이입니다. Animated GIF/APNG 지원 (최대 ${effectMaxMb ?? 2}MB), 조건 충족 시에만 표시됩니다.`,
  };

  if (!loaded) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <h3>고급 프로필</h3>
      <div className="panel">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          고급 프로필 사용 — 계절·기념일·호감도·감정 조건에 따라 배경/얼굴/효과 세트로 아바타가 바뀝니다
        </label>
        {!enabled && (
          <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            끄면 위의 기본 프로필 이미지만 사용됩니다.
          </p>
        )}
      </div>

      {enabled && (
        <>
          {(Object.keys(CAT_LABEL) as Category[]).map((cat) => {
            const catSets = sets.filter((s) => s.category === cat);
            return (
              <div key={cat} className="panel">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <b>{CAT_LABEL[cat]}</b>
                  <button
                    type="button"
                    className="small"
                    onClick={() => {
                      setCreateCat(createCat === cat ? null : cat);
                      setCreateCond(EMPTY_COND);
                      setCreateErr("");
                    }}
                  >
                    {createCat === cat ? "닫기" : "+ 세트 추가"}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{catDesc[cat]}</p>
                {createCat === cat && (
                  <CondForm
                    cat={cat}
                    value={createCond}
                    onChange={setCreateCond}
                    annivs={annivs}
                    bgSets={bgSets}
                    submitLabel="세트 추가"
                    onSubmit={() => create(cat)}
                    onCancel={() => setCreateCat(null)}
                    error={createErr}
                  />
                )}

                {catSets.map((s) => (
                  <div key={s.id} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <b>{s.name}</b>
                      <span className="muted" style={{ fontSize: 13 }}>{condSummary(s)}</span>
                      <span style={{ flex: 1 }} />
                      <button
                        type="button"
                        className="small"
                        onClick={() => {
                          if (editId === s.id) {
                            setEditId(null);
                            return;
                          }
                          setEditId(s.id);
                          setEditCond(condStateOf(s));
                          setEditErr("");
                        }}
                      >
                        조건 수정
                      </button>
                      <button type="button" className="small danger" onClick={() => removeSet(s)}>삭제</button>
                    </div>
                    {editId === s.id && (
                      <CondForm
                        cat={cat}
                        value={editCond}
                        onChange={setEditCond}
                        annivs={annivs}
                        bgSets={bgSets.filter((b) => b.id !== s.id)}
                        submitLabel="조건 저장"
                        onSubmit={() => saveCond(s)}
                        onCancel={() => setEditId(null)}
                        error={editErr}
                      />
                    )}

                    {cat === "background" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                        {s.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.url} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: 72, height: 72, borderRadius: "50%", border: "1px dashed #888", opacity: 0.6 }} />
                        )}
                        <button type="button" className="small" onClick={() => pickFile({ setId: s.id })}>
                          {s.url ? "이미지 교체" : "이미지 업로드"}
                        </button>
                      </div>
                    )}

                    {cat === "face" && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 12, marginTop: 10 }}>
                        {EMOTIONS.map((e) => {
                          const it = s.items.find((x) => x.emotion === e.key);
                          return (
                            <div key={e.key} style={{ textAlign: "center" }}>
                              {it ? (
                                <span style={{ ...CHECKER, display: "inline-block", width: 72, height: 72, borderRadius: "50%", overflow: "hidden" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={it.url} alt={e.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                </span>
                              ) : (
                                <div style={{ width: 72, height: 72, borderRadius: "50%", border: "1px dashed #888", margin: "0 auto", opacity: 0.6 }} />
                              )}
                              <div style={{ fontSize: 13, margin: "6px 0 4px" }}>{e.label}</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                                <button type="button" className="small" onClick={() => pickFile({ setId: s.id, emotion: e.key })}>
                                  {it ? "교체" : "업로드"}
                                </button>
                                <button type="button" className="small" onClick={() => setGenTarget({ set: s, emotion: e.key })}>
                                  AI{genCost != null ? ` (-${genCost.toLocaleString()})` : ""}
                                </button>
                                {it && (
                                  <>
                                    <button type="button" className="small btn-secondary" onClick={() => setChromaTarget({ set: s, item: it })}>
                                      색 지우개
                                    </button>
                                    <button type="button" className="small btn-secondary" onClick={() => removeItem(s, it)}>삭제</button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {cat === "effect" && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {s.url ? (
                            <span style={{ ...CHECKER, display: "inline-block", width: 72, height: 72, borderRadius: 8, overflow: "hidden" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={s.url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                            </span>
                          ) : (
                            <div style={{ width: 72, height: 72, borderRadius: 8, border: "1px dashed #888", opacity: 0.6 }} />
                          )}
                          <button type="button" className="small" onClick={() => pickFile({ setId: s.id, effect: true })}>
                            {s.url ? "이미지 교체" : "이미지 업로드 (GIF/APNG 가능)"}
                          </button>
                          {s.url && (
                            <button type="button" className="small" onClick={() => setEffectEditId(effectEditId === s.id ? null : s.id)}>
                              {effectEditId === s.id ? "배치 편집 닫기" : "배치 편집"}
                            </button>
                          )}
                        </div>
                        {effectEditId === s.id && s.url && (
                          <EffectEditor
                            set={s}
                            bgUrl={previewBg}
                            faceUrl={previewFace}
                            onSave={(sc, x, y) => saveTransform(s, sc, x, y)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {catSets.length === 0 && <p className="muted" style={{ marginTop: 10 }}>등록된 {CAT_LABEL[cat]}가 없습니다.</p>}
              </div>
            );
          })}
          {msg && <p style={{ color: "#ff6b6b", fontSize: 13 }}>{msg}</p>}
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      <AiGenFlow
        open={genTarget !== null}
        title={`얼굴 AI 생성 (${genTarget ? `${genTarget.set.name} · ${EMOTIONS.find((e) => e.key === genTarget.emotion)?.label ?? ""}` : ""})`}
        initialDescription={
          genTarget
            ? `원형 프로필용 상반신 인물 일러스트. 같은 인물·같은 화풍, ${EMOTIONS.find((e) => e.key === genTarget.emotion)?.label ?? "기본"} 표정. 세트 컨셉: ${genTarget.set.name}. 배경 없음(투명).`
            : ""
        }
        initialProfile={`이름: ${characterName}\n외모/설정: ${characterProfile.slice(0, 600)}`}
        titleImageUrl={titleImageUrl}
        submitSuffix={genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
        aspect={1}
        circle
        generate={generateFace}
        save={saveGeneratedFace}
        onClose={() => setGenTarget(null)}
      />

      <ChromaKeyModal
        open={chromaTarget !== null}
        title="배경색 투명 처리"
        imageUrl={
          chromaTarget
            ? `/api/characters/${characterId}/profile-sets/${chromaTarget.set.id}/items/${chromaTarget.item.id}`
            : null
        }
        onCancel={() => setChromaTarget(null)}
        onApply={applyChroma}
      />
    </div>
  );
}
