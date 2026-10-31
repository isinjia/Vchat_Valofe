"use client";

import { useState } from "react";
import ImageGenModal, { type ImageGenPayload, type GenPlace, type GenAssets } from "./ImageGenModal";
import ImageCropModal from "./ImageCropModal";

/**
 * AI 이미지 생성 플로우 공통 래퍼:
 *   입력(ImageGenModal) → 생성(회당 과금) → 후보 갤러리에서 선택 →
 *   [재생성(프롬프트 유지)] / [다운로드] / [크롭 편집 후 업로드] / [바로 업로드]
 * 서버 생성 라우트는 저장하지 않고 base64 를 돌려주며, 업로드는 기존 업로드 라우트로 한다.
 */

export interface GenCandidate {
  dataUrl: string;
  /** 이 후보를 만든 입력 (저장 시 지역 등 부가정보로 사용) */
  payload: ImageGenPayload;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // ImageGenModal 전달 props
  title: string;
  initialDescription: string;
  initialProfile?: string;
  places?: GenPlace[];
  assets?: GenAssets;
  titleImageUrl?: string | null;
  refLabel?: string;
  submitSuffix?: string;
  /** 생성 호출: dataURL(data:image/png;base64,...) 반환. 실패 시 throw (모달 안에 표시) */
  generate: (p: ImageGenPayload) => Promise<string>;
  /** 선택한 후보 업로드. 실패 시 throw */
  save: (blob: Blob, filename: string, payload: ImageGenPayload) => Promise<void>;
  /** 크롭 편집 기본 비율 */
  aspect?: number | "free";
  circle?: boolean;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export default function AiGenFlow({
  open,
  onClose,
  title,
  initialDescription,
  initialProfile,
  places,
  assets,
  titleImageUrl,
  refLabel,
  submitSuffix,
  generate,
  save,
  aspect,
  circle,
}: Props) {
  const [phase, setPhase] = useState<"input" | "pick">("input");
  const [cands, setCands] = useState<GenCandidate[]>([]);
  const [sel, setSel] = useState(0);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setPhase("input");
    setCands([]);
    setSel(0);
    setCropOpen(false);
    setCropFile(null);
    setBusy(false);
    setError("");
  };

  const closeAll = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  const current = cands[sel] ?? null;

  /** 생성: 성공하면 후보에 추가하고 선택 화면으로 */
  const onGenerate = async (p: ImageGenPayload) => {
    const dataUrl = await generate(p);
    setCands((prev) => [...prev, { dataUrl, payload: p }]);
    setSel(cands.length);
    setPhase("pick");
  };

  /** 입력 모달 닫기: 후보가 있으면 선택 화면으로 복귀, 없으면 플로우 종료 */
  const onGenClose = () => {
    if (cands.length > 0) setPhase("pick");
    else closeAll();
  };

  const discard = () => {
    if (busy) return;
    if (!confirm("생성한 이미지를 업로드하지 않고 닫을까요?")) return;
    closeAll();
  };

  const download = () => {
    if (!current) return;
    const a = document.createElement("a");
    a.href = current.dataUrl;
    a.download = `ai-${Date.now()}.png`;
    a.click();
  };

  const uploadDirect = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await dataUrlToBlob(current.dataUrl);
      await save(blob, "ai.png", current.payload);
      closeAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const openCrop = async () => {
    if (!current || busy) return;
    try {
      const blob = await dataUrlToBlob(current.dataUrl);
      setCropFile(new File([blob], "ai.png", { type: blob.type || "image/png" }));
      setCropOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <ImageGenModal
        open={phase === "input"}
        title={title}
        initialDescription={initialDescription}
        initialProfile={initialProfile}
        places={places}
        assets={assets}
        titleImageUrl={titleImageUrl}
        refLabel={refLabel}
        submitSuffix={submitSuffix}
        keepState={cands.length > 0}
        onClose={onGenClose}
        onGenerate={onGenerate}
      />

      {phase === "pick" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) discard();
          }}
        >
          <div className="modal imggen-modal" role="dialog" aria-modal="true">
            <h3>생성 결과 선택</h3>
            <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
              마음에 드는 이미지를 선택해 업로드하세요.
            </p>

            {current && (
              <div style={{ textAlign: "center", marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.dataUrl}
                  alt=""
                  style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 10, border: "1px solid var(--border)" }}
                />
              </div>
            )}

            {cands.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {cands.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSel(i)}
                    disabled={busy}
                    style={{
                      margin: 0,
                      padding: 2,
                      background: "none",
                      border: i === sel ? "2px solid var(--accent)" : "2px solid transparent",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                    title={`후보 ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.dataUrl} alt={`후보 ${i + 1}`} style={{ width: 64, height: 84, objectFit: "cover", borderRadius: 6, display: "block" }} />
                  </button>
                ))}
              </div>
            )}

            {error && <p className="crop-err">{error}</p>}

            <div className="crop-actions" style={{ flexWrap: "wrap" }}>
              <button type="button" className="btn-secondary" onClick={() => setPhase("input")} disabled={busy}>
                ↻ 재생성{submitSuffix ?? ""}
              </button>
              <button type="button" className="btn-secondary" onClick={download} disabled={busy || !current}>
                다운로드
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-secondary" onClick={discard} disabled={busy}>
                버리기
              </button>
              <button type="button" className="btn-secondary" onClick={openCrop} disabled={busy || !current}>
                크롭 편집 후 업로드
              </button>
              <button type="button" onClick={uploadDirect} disabled={busy || !current}>
                {busy ? "업로드 중..." : "이대로 업로드"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageCropModal
        open={cropOpen}
        title="생성 이미지 편집"
        aspect={aspect ?? "free"}
        circle={circle}
        initialFile={cropFile}
        onCancel={() => setCropOpen(false)}
        onConfirm={async (blob, filename) => {
          if (!current) return;
          await save(blob, filename, current.payload);
          setCropOpen(false);
          closeAll();
        }}
      />
    </>
  );
}

/** 영상 생성 결과 프리뷰 (영상은 생성 시 바로 등록됨): 다운로드 / 등록 취소 / 확인 */
export function GenVideoPreview({
  open,
  url,
  onDiscard,
  onClose,
}: {
  open: boolean;
  url: string | null;
  /** 등록 취소(삭제). 성공 시 닫힘 */
  onDiscard: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open || !url) return null;

  const download = async () => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ai-${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  const discard = async () => {
    if (busy) return;
    if (!confirm("생성된 영상 등록을 취소(삭제)할까요?")) return;
    setBusy(true);
    setError("");
    try {
      await onDiscard();
      setBusy(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal imggen-modal" role="dialog" aria-modal="true">
        <h3>영상 생성 결과</h3>
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
          영상은 이미 일러스트로 등록되었습니다. 마음에 들지 않으면 등록 취소를 누르세요.
        </p>
        <video src={url} controls autoPlay loop muted playsInline style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 10 }} />
        {error && <p className="crop-err">{error}</p>}
        <div className="crop-actions">
          <button type="button" className="btn-secondary" onClick={download} disabled={busy}>다운로드</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary danger" onClick={discard} disabled={busy}>
            {busy ? "취소 중..." : "등록 취소"}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>확인</button>
        </div>
      </div>
    </div>
  );
}
