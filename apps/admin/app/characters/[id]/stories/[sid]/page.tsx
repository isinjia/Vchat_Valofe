"use client";

import { use, useEffect, useMemo, useState } from "react";
import { StoryBoardEditor, type StoryEditorApi } from "@vchatbot/story-editor";
import type { StoryBoard } from "@vchatbot/core";

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** 스토리보드 에디터 (어드민) — AI 생성 과금 없음 */
export default function AdminStoryEditorPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = use(params);
  const base = `/api/characters/${id}/stories/${sid}`;
  const [data, setData] = useState<{
    title: string;
    title_image_url?: string | null;
    status: "draft" | "published";
    is_adult?: boolean;
    inherited_adult?: boolean;
    board: StoryBoard;
    character?: { name: string; world_name: string };
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(base)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("불러오기 실패"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const api: StoryEditorApi = useMemo(
    () => ({
      async saveDraft(title, board, titleImageUrl, isAdult) {
        const r = await fetch(base, jsonInit("PUT", { title, board, title_image_url: titleImageUrl, is_adult: isAdult }));
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok, error: d.error };
      },
      async publish(title, board, titleImageUrl, isAdult) {
        const s = await fetch(base, jsonInit("PUT", { title, board, title_image_url: titleImageUrl, is_adult: isAdult }));
        if (!s.ok) {
          const d = await s.json().catch(() => ({}));
          return { ok: false, errors: [d.error ?? "저장 실패"] };
        }
        const r = await fetch(`${base}/publish`, jsonInit("POST", { action: "publish" }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true } : { ok: false, errors: d.errors ?? [d.error ?? "공개 실패"] };
      },
      async unpublish() {
        const r = await fetch(`${base}/publish`, jsonInit("POST", { action: "unpublish" }));
        return { ok: r.ok };
      },
      async generateText(nodeId, board) {
        const r = await fetch(`${base}/generate`, jsonInit("POST", { nodeId, board }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { text: d.text } : { error: d.error ?? "생성 실패" };
      },
      async uploadImage(file) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch(`${base}/image`, { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { url: d.url } : { error: d.error ?? "업로드 실패" };
      },
      async generateImage(_nodeId, _board, prompt) {
        const r = await fetch(`${base}/image-generate`, jsonInit("POST", { prompt }));
        const d = await r.json().catch(() => ({}));
        return r.ok ? { url: d.url } : { error: d.error ?? "생성 실패" };
      },
    }),
    [base]
  );

  if (error) return <p className="muted">{error}</p>;
  if (!data) return <p className="muted">로딩 중...</p>;

  return (
    <StoryBoardEditor
      initialTitle={data.title}
      initialTitleImage={data.title_image_url ?? null}
      initialAdult={data.is_adult === true}
      inheritedAdult={data.inherited_adult === true}
      initialBoard={data.board}
      initialStatus={data.status}
      api={api}
      backHref={`/characters/${id}/stories`}
      subtitle={data.character ? `${data.character.world_name} / ${data.character.name}` : undefined}
    />
  );
}
