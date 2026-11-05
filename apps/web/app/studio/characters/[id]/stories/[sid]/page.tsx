"use client";

import { use, useEffect, useMemo, useState } from "react";
import { StoryBoardEditor, type StoryEditorApi } from "@vchatbot/story-editor";
import type { StoryBoard } from "@vchatbot/core";
import { studioFetch, jsonInit, aiCostLabel, type PricingInfo } from "../../../../studio-api";

/** 스토리보드 에디터 (스튜디오) — 저장/공개/AI 생성은 studio API 로 연결 */
export default function StoryEditorPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = use(params);
  const base = `/api/studio/characters/${id}/stories/${sid}`;
  const [data, setData] = useState<{
    title: string;
    title_image_url?: string | null;
    status: "draft" | "published";
    is_adult?: boolean;
    inherited_adult?: boolean;
    viewer_is_adult?: boolean;
    board: StoryBoard;
    character?: { name: string; world_name: string };
  } | null>(null);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    studioFetch(base)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("불러오기 실패"));
    studioFetch("/api/studio/pricing").then((r) => r.json()).then(setPricing).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const api: StoryEditorApi = useMemo(
    () => ({
      async saveDraft(title, board, titleImageUrl, isAdult) {
        const r = await studioFetch(base, jsonInit("PUT", { title, board, title_image_url: titleImageUrl, is_adult: isAdult }));
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok, error: d.error };
      },
      async publish(title, board, titleImageUrl, isAdult) {
        const s = await studioFetch(base, jsonInit("PUT", { title, board, title_image_url: titleImageUrl, is_adult: isAdult }));
        if (!s.ok) {
          const d = await s.json().catch(() => ({}));
          return { ok: false, errors: [d.error ?? "저장 실패"] };
        }
        const r = await studioFetch(`${base}/publish`, jsonInit("POST", { action: "publish" }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true } : { ok: false, errors: d.errors ?? [d.error ?? "공개 실패"] };
      },
      async unpublish() {
        const r = await studioFetch(`${base}/publish`, jsonInit("POST", { action: "unpublish" }));
        return { ok: r.ok };
      },
      async generateText(nodeId, board) {
        const r = await studioFetch(`${base}/generate`, jsonInit("POST", { nodeId, board }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { text: d.text } : { error: d.error ?? "생성 실패" };
      },
      async uploadImage(file) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await studioFetch(`${base}/image`, { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { url: d.url } : { error: d.error ?? "업로드 실패" };
      },
      async generateImage(_nodeId, _board, prompt) {
        const r = await studioFetch(`${base}/image-generate`, jsonInit("POST", { prompt }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { url: d.url } : { error: d.error ?? "생성 실패" };
      },
    }),
    [base]
  );

  if (error) return <div className="container"><p className="empty">{error}</p></div>;
  if (!data) return <div className="container"><p className="muted-center">로딩 중...</p></div>;

  return (
    <div style={{ padding: "12px 16px" }}>
      <StoryBoardEditor
        initialTitle={data.title}
        initialTitleImage={data.title_image_url ?? null}
        initialAdult={data.is_adult === true}
        inheritedAdult={data.inherited_adult === true}
        adultDisabled={data.viewer_is_adult !== true}
        initialBoard={data.board}
        initialStatus={data.status}
        api={api}
        genTextCostLabel={aiCostLabel(pricing, "story_card")}
        genImageCostLabel={pricing ? ` (-${pricing.illustGenCost.toLocaleString()}코인)` : ""}
        backHref={`/studio/characters/${id}/stories`}
        subtitle={data.character ? `${data.character.world_name} / ${data.character.name}` : undefined}
      />
    </div>
  );
}
