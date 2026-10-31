"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AI 이미지 생성 모달 (admin/web 동일 구조):
 * [이미지 설명] / [지역 정보] / [캐릭터 프로필] 분리 입력(각각 ✕ 지우기) +
 * 참조 이미지 선택 — 타이틀 / 감정 프로필 / 등록 일러스트 / 세계관 배경(지역 선택 시 그 지역 이미지 추가) / 업로드.
 * [생성] 클릭 시 섹션을 조립한 prompt 와 선택 참조를 onGenerate(payload) 로 전달. throw 하면 모달 안에 에러 표시.
 */

export interface GenRefImage {
  data: string; // base64 (data: 접두사 없음)
  mimeType: string;
}

export interface GenPlace {
  id: number;
  title: string;
  content: string;
}

export interface GenAssets {
  profiles?: { id: number; emotion: string; url: string }[];
  illustrations?: { id: number; url: string; description: string | null; media_type?: "image" | "video" }[];
  worldIllustrations?: {
    id: number;
    dict_entry_id: number | null;
    url: string;
    description: string | null;
    place_title?: string | null;
  }[];
  /** 세계관 소속 캐릭터 타이틀 이미지 (세계관 이미지 생성 시 인물 참조) */
  characterTitles?: { id: number; name: string; url: string }[];
}

export interface ImageGenPayload {
  prompt: string;
  refTitleImage: boolean;
  refImages: GenRefImage[];
  refProfileIds: number[];
  refIllustIds: number[];
  refWorldIllustIds: number[];
  refCharacterTitleIds: number[];
  /** 선택한 지역 (세계관 일러스트 생성 시 저장 지역으로도 사용) */
  placeId: number | null;
}

interface Props {
  open: boolean;
  title: string;
  /** [이미지 설명] 초기값 */
  initialDescription: string;
  /** [캐릭터 프로필] 초기값 — 넘기지 않으면 섹션 숨김 */
  initialProfile?: string;
  /** 지역 선택 목록 (세계관 지역사전) — 없으면 지역 섹션 숨김 */
  places?: GenPlace[];
  /** 참조로 고를 수 있는 등록 자산 (타이틀 외) */
  assets?: GenAssets;
  /** 타이틀 이미지 URL — 있을 때만 "타이틀 이미지를 참조로 사용" 노출 */
  titleImageUrl?: string | null;
  /** 참조 체크박스 라벨 (기본: "타이틀 이미지를 참조로 사용") */
  refLabel?: string;
  /** 생성 버튼 라벨 보조(예: 비용 표시) */
  submitSuffix?: string;
  /** 영상 생성 모드: 참조 이미지 1장 제한 + 대기 안내 문구 변경 */
  video?: boolean;
  /** true 면 다시 열릴 때 입력값을 초기화하지 않는다 (재생성 — 직전 프롬프트 유지) */
  keepState?: boolean;
  onClose: () => void;
  onGenerate: (p: ImageGenPayload) => Promise<void>;
}

const MAX_REFS = 4;
const MAX_BYTES = 8 * 1024 * 1024;

const EMOTION_LABELS: Record<string, string> = {
  default: "기본",
  joy: "기쁨",
  sad: "슬픔",
  angry: "화남",
  shy: "부끄러움",
  surprised: "놀람",
  love: "애정",
  neutral: "평온",
};

interface UploadRef extends GenRefImage {
  preview: string;
  name: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    fr.readAsDataURL(file);
  });
}

function toggleSet(set: Set<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 라벨 + ✕ 지우기 버튼이 붙은 섹션 textarea */
function SectionField({
  label,
  value,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ margin: "10px 0 4px" }}>{label}</label>
        <button
          type="button"
          className="small btn-secondary"
          style={{ margin: 0, padding: "0 8px" }}
          onClick={() => onChange("")}
          disabled={disabled || !value}
          aria-label={`${label} 지우기`}
        >
          ✕ 지우기
        </button>
      </div>
      <textarea rows={rows} style={{ width: "100%" }} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </>
  );
}

/** 선택형 참조 썸네일 */
function AssetThumb({
  url,
  label,
  selected,
  blocked,
  disabled,
  onToggle,
}: {
  url: string;
  label: string;
  selected: boolean;
  /** 한도 초과로 새로 선택 불가 */
  blocked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || (blocked && !selected)}
      title={label}
      style={{
        margin: 0,
        padding: 2,
        background: "none",
        border: selected ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: 8,
        cursor: "pointer",
        width: 72,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        style={{ width: 64, height: 84, objectFit: "cover", borderRadius: 6, display: "block", opacity: blocked && !selected ? 0.4 : 1 }}
      />
      <span
        style={{
          fontSize: 10,
          display: "block",
          maxWidth: 64,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: selected ? "var(--accent)" : "var(--muted)",
        }}
      >
        {selected ? "✓ " : ""}
        {label}
      </span>
    </button>
  );
}

export default function ImageGenModal({
  open,
  title,
  initialDescription,
  initialProfile,
  places,
  assets,
  titleImageUrl,
  refLabel,
  submitSuffix,
  video,
  keepState,
  onClose,
  onGenerate,
}: Props) {
  // 영상 생성은 참조 이미지(첫 프레임) 1장만 지원
  const maxRefs = video ? 1 : MAX_REFS;
  const [desc, setDesc] = useState(initialDescription);
  const [profile, setProfile] = useState(initialProfile ?? "");
  const [placeId, setPlaceId] = useState("");
  const [placeInfo, setPlaceInfo] = useState("");
  const [useTitle, setUseTitle] = useState(true);
  const [selProfiles, setSelProfiles] = useState<Set<number>>(new Set());
  const [selIllusts, setSelIllusts] = useState<Set<number>>(new Set());
  const [selWorld, setSelWorld] = useState<Set<number>>(new Set());
  const [selChars, setSelChars] = useState<Set<number>>(new Set());
  const [uploads, setUploads] = useState<UploadRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 열릴 때마다 초기값으로 리셋 (재생성으로 돌아온 경우는 입력 유지)
  useEffect(() => {
    if (open) {
      if (!keepState) {
        setDesc(initialDescription);
        setProfile(initialProfile ?? "");
        setPlaceId("");
        setPlaceInfo("");
        setUseTitle(true);
        setSelProfiles(new Set());
        setSelIllusts(new Set());
        setSelWorld(new Set());
        setSelChars(new Set());
        setUploads([]);
      }
      setBusy(false);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const refCount =
    (titleImageUrl && useTitle ? 1 : 0) + selProfiles.size + selIllusts.size + selWorld.size + selChars.size + uploads.length;
  const blocked = refCount >= maxRefs;

  const pickPlace = (v: string) => {
    setPlaceId(v);
    const p = places?.find((x) => String(x.id) === v);
    setPlaceInfo(p ? `${p.title}: ${p.content}` : "");
    // 지역이 바뀌면 다른 지역 배경 선택은 해제 (공통 배경은 유지)
    if (assets?.worldIllustrations) {
      const keep = new Set(
        assets.worldIllustrations
          .filter((w) => selWorld.has(w.id) && (w.dict_entry_id == null || String(w.dict_entry_id) === v))
          .map((w) => w.id)
      );
      setSelWorld(keep);
    }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError("");
    const next = [...uploads];
    for (const f of Array.from(list)) {
      if (refCount - uploads.length + next.length >= maxRefs) {
        setError(`참조 이미지는 선택·업로드 합산 최대 ${maxRefs}장입니다.`);
        break;
      }
      if (!f.type.startsWith("image/")) {
        setError("이미지 파일만 선택할 수 있습니다.");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError("참조 이미지는 8MB 이하여야 합니다.");
        continue;
      }
      try {
        const url = await readAsDataUrl(f);
        next.push({ data: url.slice(url.indexOf(",") + 1), mimeType: f.type, preview: url, name: f.name });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setUploads(next);
  };

  const submit = async () => {
    if (busy) return;
    if (!desc.trim() && !profile.trim()) {
      setError("이미지 설명을 입력하세요.");
      return;
    }
    const parts = [`[이미지 설명]\n${desc.trim() || "일러스트"}`];
    if (placeInfo.trim()) parts.push(`[지역 정보]\n${placeInfo.trim()}`);
    if (profile.trim()) parts.push(`[캐릭터 프로필]\n${profile.trim()}`);
    setBusy(true);
    setError("");
    try {
      await onGenerate({
        prompt: parts.join("\n\n"),
        refTitleImage: !!titleImageUrl && useTitle,
        refImages: uploads.map((r) => ({ data: r.data, mimeType: r.mimeType })),
        refProfileIds: [...selProfiles],
        refIllustIds: [...selIllusts],
        refWorldIllustIds: [...selWorld],
        refCharacterTitleIds: [...selChars],
        placeId: placeId ? Number(placeId) : null,
      });
      setBusy(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // 세계관 배경: 공통(지역 미지정) + 선택한 지역의 이미지만 노출
  const worldThumbs = (assets?.worldIllustrations ?? []).filter(
    (w) => w.dict_entry_id == null || String(w.dict_entry_id) === placeId
  );
  // 영상 일러스트는 이미지 참조로 쓸 수 없다
  const imageIllusts = (assets?.illustrations ?? []).filter((i) => i.media_type !== "video");

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal imggen-modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>

        <SectionField label="이미지 설명" value={desc} rows={4} disabled={busy} onChange={setDesc} />

        {places && places.length > 0 && (
          <>
            <label style={{ margin: "10px 0 4px" }}>지역 (세계관 지역사전)</label>
            <select value={placeId} onChange={(e) => pickPlace(e.target.value)} disabled={busy}>
              <option value="">지역 없음</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {placeId && (
              <SectionField label="지역 정보 (프롬프트에 포함)" value={placeInfo} rows={3} disabled={busy} onChange={setPlaceInfo} />
            )}
          </>
        )}

        {initialProfile !== undefined && (
          <SectionField label="캐릭터 프로필" value={profile} rows={5} disabled={busy} onChange={setProfile} />
        )}

        <div className="ref-box">
          <div className="ref-box-head">
            <b>참조 이미지</b>
            <span className="muted">썸네일을 눌러 선택 — 선택한 이미지의 설명이 생성 AI 에 함께 전달됩니다</span>
            <span className={`ref-count${blocked ? " full" : ""}`}>{refCount}/{maxRefs}</span>
          </div>

          {titleImageUrl && (
            <div className="ref-group">
              <div className="ref-group-title">{refLabel ?? "타이틀 이미지"}</div>
              <div className="ref-grid">
                <AssetThumb
                  url={titleImageUrl}
                  label="타이틀"
                  selected={useTitle}
                  blocked={blocked}
                  disabled={busy}
                  onToggle={() => setUseTitle(!useTitle)}
                />
              </div>
            </div>
          )}

          {(assets?.profiles?.length ?? 0) > 0 && (
            <div className="ref-group">
              <div className="ref-group-title">감정 프로필</div>
              <div className="ref-grid">
                {assets!.profiles!.map((p) => (
                  <AssetThumb
                    key={p.id}
                    url={p.url}
                    label={EMOTION_LABELS[p.emotion] ?? p.emotion}
                    selected={selProfiles.has(p.id)}
                    blocked={blocked}
                    disabled={busy}
                    onToggle={() => setSelProfiles(toggleSet(selProfiles, p.id))}
                  />
                ))}
              </div>
            </div>
          )}

          {imageIllusts.length > 0 && (
            <div className="ref-group">
              <div className="ref-group-title">등록된 일러스트</div>
              <div className="ref-grid">
                {imageIllusts.map((i) => (
                  <AssetThumb
                    key={i.id}
                    url={i.url}
                    label={i.description || `#${i.id}`}
                    selected={selIllusts.has(i.id)}
                    blocked={blocked}
                    disabled={busy}
                    onToggle={() => setSelIllusts(toggleSet(selIllusts, i.id))}
                  />
                ))}
              </div>
            </div>
          )}

          {(assets?.characterTitles?.length ?? 0) > 0 && (
            <div className="ref-group">
              <div className="ref-group-title">세계관 캐릭터</div>
              <div className="ref-grid">
                {assets!.characterTitles!.map((c) => (
                  <AssetThumb
                    key={c.id}
                    url={c.url}
                    label={c.name}
                    selected={selChars.has(c.id)}
                    blocked={blocked}
                    disabled={busy}
                    onToggle={() => setSelChars(toggleSet(selChars, c.id))}
                  />
                ))}
              </div>
            </div>
          )}

          {worldThumbs.length > 0 && (
            <div className="ref-group">
              <div className="ref-group-title">세계관 배경{placeId ? " (공통 + 선택 지역)" : " (공통)"}</div>
              <div className="ref-grid">
                {worldThumbs.map((w) => (
                  <AssetThumb
                    key={w.id}
                    url={w.url}
                    label={w.place_title ? `${w.place_title}${w.description ? ` · ${w.description}` : ""}` : (w.description || "공통")}
                    selected={selWorld.has(w.id)}
                    blocked={blocked}
                    disabled={busy}
                    onToggle={() => setSelWorld(toggleSet(selWorld, w.id))}
                  />
                ))}
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="ref-group">
            <div className="ref-group-title">직접 업로드</div>
            <div className="ref-grid">
              {uploads.map((r, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.preview} alt={r.name} style={{ width: 72, height: 96, objectFit: "cover", borderRadius: 6, display: "block" }} />
                  <button
                    type="button"
                    className="danger small"
                    style={{ position: "absolute", top: 2, right: 2, margin: 0, padding: "0 6px" }}
                    onClick={() => setUploads(uploads.filter((_, j) => j !== i))}
                    disabled={busy}
                    aria-label="참조 이미지 제거"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="small btn-secondary"
                style={{ margin: 0, alignSelf: "center" }}
                onClick={() => fileRef.current?.click()}
                disabled={busy || blocked}
              >
                + 업로드 (각 8MB 이하)
              </button>
            </div>
          </div>
        </div>

        {error && <p className="crop-err">{error}</p>}

        <div className="crop-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? `⏳ 생성 중... (최대 ${video ? "10분" : "2분"})` : `생성${submitSuffix ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
