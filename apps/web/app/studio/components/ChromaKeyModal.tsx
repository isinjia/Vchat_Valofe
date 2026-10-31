"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 색 지우개: 이미지의 특정 색(배경 단색)을 투명 처리해 PNG 로 돌려준다.
 * - 미리보기 클릭으로 지울 색 선택 (열릴 때 네 모서리 색으로 자동 추정)
 * - 허용 오차 슬라이더로 범위 조절, 경계는 부드럽게 반투명 처리
 * imageUrl 은 같은 오리진(프록시) URL 이어야 캔버스 픽셀 접근이 가능하다.
 */
export default function ChromaKeyModal({
  open,
  title,
  imageUrl,
  onCancel,
  onApply,
}: {
  open: boolean;
  title: string;
  imageUrl: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [keyColor, setKeyColor] = useState<[number, number, number] | null>(null);
  const [tolerance, setTolerance] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 열릴 때 이미지 로드 + 모서리 색으로 키 컬러 추정
  useEffect(() => {
    if (!open || !imageUrl) return;
    setImg(null);
    setKeyColor(null);
    setTolerance(30);
    setError("");
    const el = new Image();
    el.onload = () => {
      setImg(el);
      try {
        const c = document.createElement("canvas");
        c.width = el.naturalWidth;
        c.height = el.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(el, 0, 0);
        const corners: [number, number][] = [
          [1, 1],
          [c.width - 2, 1],
          [1, c.height - 2],
          [c.width - 2, c.height - 2],
        ];
        // 네 모서리 평균색을 기본 키 컬러로
        let r = 0, g = 0, b = 0;
        for (const [x, y] of corners) {
          const d = ctx.getImageData(x, y, 1, 1).data;
          r += d[0]; g += d[1]; b += d[2];
        }
        setKeyColor([Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)]);
      } catch {
        setError("이미지 픽셀을 읽을 수 없습니다. (CORS)");
      }
    };
    el.onerror = () => setError("이미지를 불러올 수 없습니다.");
    el.src = imageUrl;
  }, [open, imageUrl]);

  /** 키 컬러 제거를 적용한 캔버스 생성 (풀사이즈) */
  const buildCanvas = (): HTMLCanvasElement | null => {
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    if (!keyColor) return c;
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    const [kr, kg, kb] = keyColor;
    // RGB 거리 기준: 허용 오차 이내는 완전 투명, 1.4배까지는 경계 반투명
    const maxDist = 441.673; // sqrt(255^2*3)
    const th = (tolerance / 100) * maxDist;
    const soft = th * 1.4;
    for (let i = 0; i < px.length; i += 4) {
      const dr = px[i] - kr;
      const dg = px[i + 1] - kg;
      const db = px[i + 2] - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= th) px[i + 3] = 0;
      else if (dist < soft) px[i + 3] = Math.round(px[i + 3] * ((dist - th) / (soft - th)));
    }
    ctx.putImageData(data, 0, 0);
    return c;
  };

  // 미리보기 갱신 (표시용 축소 렌더)
  useEffect(() => {
    if (!open || !img) return;
    const view = canvasRef.current;
    if (!view) return;
    const full = buildCanvas();
    if (!full) return;
    const maxW = 420;
    const ratio = Math.min(1, maxW / full.width);
    view.width = Math.round(full.width * ratio);
    view.height = Math.round(full.height * ratio);
    const ctx = view.getContext("2d")!;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(full, 0, 0, view.width, view.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, img, keyColor, tolerance]);

  if (!open) return null;

  /** 미리보기 클릭 → 원본 좌표의 색을 키 컬러로 */
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const view = canvasRef.current!;
    const rect = view.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    try {
      const d = ctx.getImageData(Math.max(0, Math.min(c.width - 1, x)), Math.max(0, Math.min(c.height - 1, y)), 1, 1).data;
      setKeyColor([d[0], d[1], d[2]]);
    } catch {
      setError("이미지 픽셀을 읽을 수 없습니다. (CORS)");
    }
  };

  const apply = async () => {
    if (busy) return;
    const full = buildCanvas();
    if (!full) return;
    setBusy(true);
    setError("");
    full.toBlob(async (blob) => {
      if (!blob) {
        setError("PNG 변환에 실패했습니다.");
        setBusy(false);
        return;
      }
      try {
        await onApply(blob);
        setBusy(false);
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    }, "image/png");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <h3>{title}</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          이미지를 클릭해 지울 배경색을 선택하세요. (열릴 때 모서리 색으로 자동 선택됨)
        </p>
        <div style={{ textAlign: "center", background: "repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 / 16px 16px", borderRadius: 8 }}>
          <canvas ref={canvasRef} onClick={pick} style={{ maxWidth: "100%", cursor: "crosshair", display: "block", margin: "0 auto" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 13 }}>지울 색</span>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: keyColor ? `rgb(${keyColor[0]},${keyColor[1]},${keyColor[2]})` : "transparent",
            }}
          />
          <span style={{ fontSize: 13, marginLeft: 8 }}>허용 오차 {tolerance}</span>
          <input
            type="range"
            min={1}
            max={80}
            value={tolerance}
            style={{ flex: 1 }}
            onChange={(e) => setTolerance(Number(e.target.value))}
            disabled={busy}
          />
        </div>
        {error && <p className="crop-err">{error}</p>}
        <div className="crop-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>취소</button>
          <button type="button" onClick={apply} disabled={busy || !img}>
            {busy ? "⏳ 적용 중..." : "투명 처리 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
