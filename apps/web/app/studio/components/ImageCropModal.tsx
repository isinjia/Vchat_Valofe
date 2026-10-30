"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 이미지 업로드 팝업: 파일 선택(또는 드롭) → 확대/이동 크롭 → 확인 시 onConfirm(blob) 호출.
 * 외부 패키지 없이 포인터 이벤트 + 캔버스로 구현. (admin/web 동일 구조)
 *
 * 좌표계: 크롭 상태는 "원본 이미지 좌표의 프레임 중심(cx, cy)" + "줌(1~5)" 로 보관한다.
 *  - 배율 s(프레임px / 원본px) = coverScale * zoom,  coverScale = max(fw/nw, fh/nh)
 *  - 원본에서 잘라낼 크기: sw = fw/s, sh = fh/s
 *  - 프레임 좌상단에 해당하는 원본 좌표: sx = cx - sw/2, sy = cy - sh/2
 */

interface Props {
  open: boolean;
  title?: string;
  aspect: number | "free";
  /** true 면 크롭 프레임을 원형 마스크로 표시 (저장 이미지는 사각형) */
  circle?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob, filename: string) => Promise<void>;
}

type FreeMode = "orig" | "3:4" | "1:1" | "4:3";
const FREE_RATIOS: { key: FreeMode; label: string; v: number }[] = [
  { key: "orig", label: "원본 비율", v: 0 },
  { key: "3:4", label: "3:4", v: 3 / 4 },
  { key: "1:1", label: "1:1", v: 1 },
  { key: "4:3", label: "4:3", v: 4 / 3 },
];

const MAX_W = 420; // 프레임 최대 크기
const MAX_H = 560;
const MARGIN = 28; // 프레임 바깥으로 보이는 어두운 여백
const MAX_ZOOM = 5; // 최소(cover) 배율 대비 최대 배수
const MAX_OUT = 2048; // 출력 긴 변 상한

interface Src {
  url: string;
  nw: number;
  nh: number;
  type: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export default function ImageCropModal({ open, title, aspect, circle, onCancel, onConfirm }: Props) {
  const [src, setSrc] = useState<Src | null>(null);
  const [freeMode, setFreeMode] = useState<FreeMode>("orig");
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 }); // 프레임 중심의 원본 좌표
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const urlRef = useRef<string | null>(null);

  // ObjectURL 정리
  const revoke = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  // 닫힐 때 상태 초기화 + URL 해제 / 언마운트 시 해제
  useEffect(() => {
    if (!open) {
      revoke();
      setSrc(null);
      setZoom(1);
      setFreeMode("orig");
      setBusy(false);
      setError("");
      setDragOver(false);
    }
  }, [open]);
  useEffect(() => revoke, []);

  // ---- 프레임 크기 계산 ----
  const ratio = (() => {
    if (aspect !== "free") return aspect;
    if (!src) return 1;
    const f = FREE_RATIOS.find((x) => x.key === freeMode)!;
    return f.key === "orig" ? src.nw / src.nh : f.v;
  })();
  const r = clamp(ratio, 0.25, 4);
  // 최대 영역(420x560) 안에 비율 r 로 최대한 크게
  const fw = r >= MAX_W / MAX_H ? MAX_W : Math.round(MAX_H * r);
  const fh = r >= MAX_W / MAX_H ? Math.round(MAX_W / r) : MAX_H;

  // 배율: 최소 = 프레임을 꽉 채우는 cover 배율
  const cover = src ? Math.max(fw / src.nw, fh / src.nh) : 1;
  const s = cover * zoom;

  // 프레임이 이미지 밖으로 나가지 않도록 중심 좌표 클램프
  const clampCenter = useCallback(
    (x: number, y: number, sc: number) => {
      if (!src) return { x, y };
      const hw = fw / (2 * sc);
      const hh = fh / (2 * sc);
      return { x: clamp(x, hw, src.nw - hw), y: clamp(y, hh, src.nh - hh) };
    },
    [src, fw, fh]
  );
  const cc = src ? clampCenter(center.x, center.y, s) : center;

  // 뷰 초기화: 줌 1(cover) + 이미지 중앙
  const resetView = (nw: number, nh: number) => {
    setZoom(1);
    setCenter({ x: nw / 2, y: nh / 2 });
  };

  // ---- 파일 로드 ----
  const loadFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 선택할 수 있습니다.");
      return;
    }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      revoke();
      urlRef.current = url;
      setSrc({ url, nw: im.naturalWidth, nh: im.naturalHeight, type: file.type });
      setFreeMode("orig");
      resetView(im.naturalWidth, im.naturalHeight);
      setError("");
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      setError("이미지를 읽을 수 없습니다.");
    };
    im.src = url;
  };

  // 휠 확대/축소 (passive:false 로 페이지 스크롤 방지). 프레임 중심 기준.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, MAX_ZOOM));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [src, open]);

  // Esc 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  // ---- 드래그 이동 ----
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !src) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    // 화면 이동량(px) → 원본 좌표 이동량 = /s. 이미지가 손을 따라가므로 중심은 반대 방향.
    setCenter((c) => {
      const base = clampCenter(c.x, c.y, s);
      return clampCenter(base.x - dx / s, base.y - dy / s, s);
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // ---- 확인: 원본 해상도로 크롭 ----
  const confirm = async () => {
    const im = imgRef.current;
    if (!src || !im || busy) return;
    setBusy(true);
    setError("");
    try {
      // 프레임 px → 원본 px
      const sw = fw / s;
      const sh = fh / s;
      const sx = clamp(cc.x - sw / 2, 0, Math.max(0, src.nw - sw));
      const sy = clamp(cc.y - sh / 2, 0, Math.max(0, src.nh - sh));
      // 출력 크기: 크롭 영역 원본 크기, 긴 변 2048 초과 시 비율 유지 축소
      const k = Math.min(1, MAX_OUT / Math.max(sw, sh));
      const ow = Math.max(1, Math.round(sw * k));
      const oh = Math.max(1, Math.round(sh * k));
      const canvas = document.createElement("canvas");
      canvas.width = ow;
      canvas.height = oh;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("캔버스를 사용할 수 없습니다.");
      const png = src.type === "image/png";
      if (!png) {
        // JPEG 는 투명 불가 → 흰 배경
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, ow, oh);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, ow, oh);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res, png ? "image/png" : "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("이미지 변환에 실패했습니다.");
      await onConfirm(blob, png ? "crop.png" : "crop.jpg");
      setBusy(false);
      onCancel(); // 성공 시 닫기
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal crop-modal" role="dialog" aria-modal="true">
        <h3>{title ?? "이미지 업로드"}</h3>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            loadFile(e.target.files?.[0]);
            e.target.value = ""; // 같은 파일 재선택 허용
          }}
        />

        {!src ? (
          <div
            className={`crop-drop ${dragOver ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              loadFile(e.dataTransfer.files?.[0]);
            }}
          >
            <p>이미지 파일을 여기로 끌어다 놓거나</p>
            <button type="button" onClick={() => fileRef.current?.click()}>이미지 파일 선택</button>
          </div>
        ) : (
          <>
            {aspect === "free" && (
              <div className="crop-ratios">
                {FREE_RATIOS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`small ${freeMode === f.key ? "" : "btn-secondary"}`}
                    onClick={() => {
                      setFreeMode(f.key);
                      resetView(src.nw, src.nh);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* 스테이지: 프레임 + 사방 MARGIN 만큼 잘릴 부분이 어둡게 보임 */}
            <div
              ref={stageRef}
              className="crop-stage"
              style={{ width: fw + MARGIN * 2, height: fh + MARGIN * 2 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={src.url}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  width: src.nw * s,
                  height: src.nh * s,
                  // 이미지 좌상단 = 프레임 좌상단(MARGIN) + (프레임 중심 오프셋 fw/2 - cx*s)
                  left: MARGIN + fw / 2 - cc.x * s,
                  top: MARGIN + fh / 2 - cc.y * s,
                  maxWidth: "none",
                }}
              />
              <div className={`crop-frame${circle ? " circle" : ""}`} style={{ left: MARGIN, top: MARGIN, width: fw, height: fh }} />
            </div>

            <div className="crop-zoom-row">
              <span>축소</span>
              <input
                className="crop-slider"
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(clamp(Number(e.target.value), 1, MAX_ZOOM))}
              />
              <span>확대</span>
            </div>
          </>
        )}

        {error && <p className="crop-err">{error}</p>}

        <div className="crop-actions">
          {src && (
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              다른 이미지 선택
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>취소</button>
          {src && (
            <button type="button" onClick={confirm} disabled={busy}>
              {busy ? "업로드 중..." : "확인(업로드)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
