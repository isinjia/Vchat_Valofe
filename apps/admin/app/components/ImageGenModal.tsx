"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AI 이미지 생성 모달: 제목 + 프롬프트(수정 가능) + 참조 이미지(타이틀 이미지 / 업로드 최대 2장).
 * [생성] 클릭 시 onGenerate(payload) 호출. 성공하면 닫힘, throw 하면 모달 안에 에러 표시.
 * (admin/web 동일 구조)
 */

export interface GenRefImage {
  data: string; // base64 (data: 접두사 없음)
  mimeType: string;
}

export interface ImageGenPayload {
  prompt: string;
  refTitleImage: boolean;
  refImages: GenRefImage[];
}

interface Props {
  open: boolean;
  title: string;
  initialPrompt: string;
  /** 타이틀 이미지 URL — 있을 때만 "타이틀 이미지를 참조로 사용" 노출 */
  titleImageUrl?: string | null;
  /** 생성 버튼 라벨 보조(예: 비용 표시) */
  submitSuffix?: string;
  onClose: () => void;
  onGenerate: (p: ImageGenPayload) => Promise<void>;
}

const MAX_REFS = 2;
const MAX_BYTES = 8 * 1024 * 1024;

interface Ref extends GenRefImage {
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

export default function ImageGenModal({ open, title, initialPrompt, titleImageUrl, submitSuffix, onClose, onGenerate }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [useTitle, setUseTitle] = useState(true);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 열릴 때마다 자동 채움 프롬프트로 초기화
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setUseTitle(true);
      setRefs([]);
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

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError("");
    const next = [...refs];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_REFS) {
        setError(`참조 이미지는 최대 ${MAX_REFS}장까지 추가할 수 있습니다.`);
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
    setRefs(next);
  };

  const submit = async () => {
    if (busy) return;
    if (!prompt.trim()) {
      setError("프롬프트를 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onGenerate({
        prompt: prompt.trim(),
        refTitleImage: !!titleImageUrl && useTitle,
        refImages: refs.map((r) => ({ data: r.data, mimeType: r.mimeType })),
      });
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
      <div className="modal crop-modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>

        <label>프롬프트</label>
        <textarea
          rows={9}
          style={{ width: "100%" }}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
        />

        <label>참조 이미지 (선택)</label>
        {titleImageUrl && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}>
            <input
              type="checkbox"
              checked={useTitle}
              style={{ width: "auto", margin: 0 }}
              onChange={(e) => setUseTitle(e.target.checked)}
              disabled={busy}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={titleImageUrl} alt="" style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 4 }} />
            타이틀 이미지를 참조로 사용
          </label>
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {refs.map((r, i) => (
            <div key={i} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.preview} alt={r.name} style={{ width: 72, height: 96, objectFit: "cover", borderRadius: 6, display: "block" }} />
              <button
                type="button"
                className="danger small"
                style={{ position: "absolute", top: 2, right: 2, margin: 0, padding: "0 6px" }}
                onClick={() => setRefs(refs.filter((_, j) => j !== i))}
                disabled={busy}
                aria-label="참조 이미지 제거"
              >
                ×
              </button>
            </div>
          ))}
          {refs.length < MAX_REFS && (
            <button type="button" className="small btn-secondary" style={{ margin: 0 }} onClick={() => fileRef.current?.click()} disabled={busy}>
              + 이미지 추가 ({refs.length}/{MAX_REFS}, 각 8MB 이하)
            </button>
          )}
        </div>

        {error && <p className="crop-err">{error}</p>}

        <div className="crop-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? "⏳ 생성 중... (최대 2분)" : `생성${submitSuffix ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
