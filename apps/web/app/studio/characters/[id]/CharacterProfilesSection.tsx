"use client";

import { useEffect, useState } from "react";
import ImageCropModal from "../../components/ImageCropModal";
import ImageGenModal, { type ImageGenPayload } from "../../components/ImageGenModal";
import { studioFetch } from "../../studio-api";

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

interface Profile {
  id: number;
  emotion: string;
  url: string;
}

/** 프로필 이미지 (채팅 말풍선 앞 원형 표시) — 기본 + 감정별 8슬롯 */
export default function CharacterProfilesSection({
  characterId,
  characterName,
  characterProfile,
  titleImageUrl,
  genCost,
}: {
  characterId: number | string;
  characterName: string;
  characterProfile: string;
  titleImageUrl?: string | null;
  /** AI 생성 비용(코인) — web 에서만 표시 */
  genCost?: number | null;
}) {
  const base = `/api/studio/characters/${characterId}/profiles`;
  const [items, setItems] = useState<Profile[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [genTarget, setGenTarget] = useState<string | null>(null); // AI 생성 모달 대상 슬롯

  const load = async () => {
    const res = await studioFetch(base);
    if (res.ok) setItems(await res.json());
  };
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const upload = async (blob: Blob, filename: string) => {
    if (!target) return;
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("emotion", target);
    const res = await studioFetch(base, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    await load();
  };

  const defaultUrl = items.find((x) => x.emotion === "default")?.url ?? null;

  /** 슬롯별 자동 [이미지 설명] */
  const buildDesc = (emotion: string) => {
    const emoLabel = EMOTIONS.find((e) => e.key === emotion)?.label ?? "";
    return emotion === "default"
      ? "원형 프로필용 얼굴 클로즈업 초상. 이름/외모/화풍 유지, 정면 응시, 단순한 배경."
      : `원형 프로필용 얼굴 클로즈업 초상. 참조 이미지와 같은 인물·같은 화풍, ${emoLabel} 표정.`;
  };
  const profileText = `이름: ${characterName}\n외모/설정: ${characterProfile.slice(0, 600)}`;

  /** AI 생성 모달 확인 → 생성 라우트 호출 (실패 시 throw → 모달 안에 에러 표시) */
  const generate = async (p: ImageGenPayload) => {
    if (!genTarget) return;
    const isDefault = genTarget === "default";
    const useDefault = !isDefault && !!defaultUrl;
    const res = await studioFetch(`${base}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emotion: genTarget,
        prompt: p.prompt,
        useTitleRef: p.refTitleImage && !useDefault,
        useDefaultProfileRef: p.refTitleImage && useDefault,
        refImages: p.refImages,
        refProfileIds: p.refProfileIds,
        refIllustIds: p.refIllustIds,
        refWorldIllustIds: p.refWorldIllustIds,
      }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    await load();
  };

  const remove = async (p: Profile) => {
    if (!confirm("이 프로필 이미지를 삭제할까요?")) return;
    const res = await studioFetch(`${base}/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      setMsg(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setMsg("");
    await load();
  };

  const label = EMOTIONS.find((e) => e.key === target)?.label ?? "";

  return (
    <div style={{ margin: "16px 0" }}>
      <label>프로필 이미지 (채팅 말풍선 앞 원형 표시)</label>
      <p style={{ fontSize: 13, opacity: 0.7, margin: "4px 0 10px" }}>
        기본 프로필만 있어도 되고, 감정별로 등록하면 대화 분위기에 따라 바뀝니다.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 12 }}>
        {EMOTIONS.map((e) => {
          const p = items.find((x) => x.emotion === e.key);
          return (
            <div key={e.key} style={{ textAlign: "center" }}>
              {p ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.url}
                  alt={e.label}
                  style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", display: "block", margin: "0 auto" }}
                />
              ) : (
                <div
                  style={{ width: 72, height: 72, borderRadius: "50%", border: "1px dashed #888", margin: "0 auto", opacity: 0.6 }}
                />
              )}
              <div style={{ fontSize: 13, margin: "6px 0 4px" }}>{e.label}</div>
              <button type="button" className="small" onClick={() => setTarget(e.key)}>
                {p ? "교체" : "업로드"}
              </button>{" "}
              <button type="button" className="small" onClick={() => setGenTarget(e.key)}>
                AI 생성{genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
              </button>
              {p && (
                <>
                  {" "}
                  <button type="button" className="small btn-secondary" onClick={() => remove(p)}>
                    삭제
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {msg && <p style={{ color: "#ff6b6b", fontSize: 13 }}>{msg}</p>}
      <ImageGenModal
        open={genTarget !== null}
        title={`프로필 AI 생성 (${EMOTIONS.find((e) => e.key === genTarget)?.label ?? ""})`}
        initialDescription={genTarget ? buildDesc(genTarget) : ""}
        initialProfile={profileText}
        titleImageUrl={genTarget === "default" ? titleImageUrl : (defaultUrl ?? titleImageUrl)}
        refLabel={genTarget === "default" || !defaultUrl ? "타이틀 이미지를 참조로 사용" : "기본 프로필을 참조로 사용"}
        submitSuffix={genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
        onClose={() => setGenTarget(null)}
        onGenerate={generate}
      />
      <ImageCropModal
        open={target !== null}
        title={`프로필 이미지 업로드 (${label})`}
        aspect={1}
        circle
        onCancel={() => setTarget(null)}
        onConfirm={upload}
      />
    </div>
  );
}
