"use client";

import { useEffect, useRef, useState } from "react";
import ImageGenModal, { type ImageGenPayload, type GenPlace } from "../../components/ImageGenModal";
import { studioFetch, jsonInit } from "../../studio-api";

/** 세계관 일러스트: 지역사전 항목별 배경 이미지 (업로드 + AI 생성, admin/web 동일 구조) */

interface WorldIllust {
  id: number;
  dict_entry_id: number | null;
  url: string;
  description: string | null;
  place_title: string | null;
}

export default function WorldIllustrationsSection({
  worldId,
  titleImageUrl,
  genCost,
}: {
  worldId: number | string;
  titleImageUrl?: string | null;
  /** AI 생성 비용(코인) — web 에서만 표시 */
  genCost?: number | null;
}) {
  const base = `/api/studio/worlds/${worldId}/illustrations`;
  const [items, setItems] = useState<WorldIllust[]>([]);
  const [places, setPlaces] = useState<GenPlace[]>([]);
  const [placeId, setPlaceId] = useState(""); // 업로드 저장 지역
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    studioFetch(base)
      .then((r) => r.json())
      .then((l) => setItems(Array.isArray(l) ? l : []))
      .catch(() => {});

  useEffect(() => {
    load();
    studioFetch(`/api/studio/worlds/${worldId}/entries`)
      .then((r) => r.json())
      .then((l: { id: number; title: string; category: string; content?: string }[]) =>
        setPlaces(
          (Array.isArray(l) ? l : [])
            .filter((e) => e.category === "location")
            .map((e) => ({ id: e.id, title: e.title, content: e.content ?? "" }))
        )
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  const upload = async (file: File) => {
    setMsg("");
    const form = new FormData();
    form.append("file", file);
    if (placeId) form.append("dict_entry_id", placeId);
    if (desc.trim()) form.append("description", desc.trim());
    const res = await studioFetch(base, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setDesc("");
    load();
  };

  /** 생성 모달 확인 — 모달에서 고른 지역이 프롬프트 [지역 정보]와 저장 지역 둘 다에 쓰인다 */
  const generate = async (p: ImageGenPayload) => {
    const res = await studioFetch(
      `${base}/generate`,
      jsonInit("POST", {
        prompt: p.prompt,
        dictEntryId: p.placeId,
        description: desc.trim() || undefined,
        refTitleImage: p.refTitleImage,
        refImages: p.refImages,
        refWorldIllustIds: p.refWorldIllustIds,
      })
    );
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    await load();
  };

  const changePlace = async (it: WorldIllust, value: string) => {
    const res = await studioFetch(
      `${base}/${it.id}`,
      jsonInit("PUT", { dict_entry_id: value ? Number(value) : null, description: it.description })
    );
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      setMsg(`변경 실패: ${r.error ?? res.statusText}`);
      return;
    }
    load();
  };

  const remove = async (it: WorldIllust) => {
    if (!confirm("이 배경 이미지를 삭제할까요?")) return;
    const res = await studioFetch(`${base}/${it.id}`, { method: "DELETE" });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      setMsg(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    load();
  };

  return (
    <>
      <h3>세계관 일러스트 (지역 배경)</h3>
      <div className="panel">
        <div className="notice">
          지역사전 항목별 배경 이미지를 보관합니다. 캐릭터 AI 일러스트 생성에서 배경 참조로 쓸 수 있고, 지역을
          비우면 세계관 공통 배경이 됩니다.
        </div>
        <div className="row">
          <div>
            <label>지역 (지역사전)</label>
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">세계관 공통</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label>설명 (선택)</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="예: 낮, 축제 중" />
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="small" onClick={() => fileRef.current?.click()}>이미지 업로드</button>
          <button type="button" className="small" onClick={() => setGenOpen(true)}>
            AI 생성{genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
          </button>
        </div>
        {msg && <p style={{ color: "#ff6b6b", fontSize: 13 }}>{msg}</p>}

        <table style={{ marginTop: 14 }}>
          <thead>
            <tr><th>미리보기</th><th>지역</th><th>설명</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><img src={it.url} alt={it.description ?? ""} className="thumb" /></td>
                <td>
                  <select value={it.dict_entry_id ?? ""} onChange={(e) => changePlace(it, e.target.value)} style={{ width: "auto", minWidth: 140 }}>
                    <option value="">세계관 공통</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </td>
                <td>{it.description}</td>
                <td><button className="danger small" onClick={() => remove(it)}>삭제</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="muted">등록된 배경 이미지가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <ImageGenModal
        open={genOpen}
        title="지역 배경 AI 생성"
        initialDescription="가로형 배경 일러스트. 인물 없이 장소의 풍경·분위기를 묘사."
        places={places}
        assets={{ worldIllustrations: items }}
        titleImageUrl={titleImageUrl}
        refLabel="세계관 타이틀 이미지를 참조로 사용"
        submitSuffix={genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
        onClose={() => setGenOpen(false)}
        onGenerate={generate}
      />
    </>
  );
}
