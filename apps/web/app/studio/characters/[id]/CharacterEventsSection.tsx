"use client";

import { useEffect, useState } from "react";
import { type ImageGenPayload } from "../../components/ImageGenModal";
import AiGenFlow from "../../components/AiGenFlow";
import { buildImageDescription, buildProfileText } from "../../components/imagePrompt";
import { studioFetch } from "../../studio-api";

export interface CharEvent {
  id: number;
  name: string;
  trigger_affinity_min: number | null;
  trigger_keywords: string | null;
  trigger_relationship: string | null;
  situation: string;
  success_condition: string;
  fail_condition: string | null;
  set_relationship: string | null;
  retry_hours: number;
  max_turns: number;
  is_active: number;
  success_count?: number;
  success_line?: string | null;
  success_illustration_id?: number | null;
}

const EMPTY = {
  name: "",
  trigger_affinity_min: "",
  trigger_keywords: "",
  trigger_relationship: "",
  situation: "",
  success_condition: "",
  fail_condition: "",
  set_relationship: "",
  retry_hours: "72",
  max_turns: "6",
  is_active: true,
  success_line: "",
  success_illustration_id: "" as string,
};

const REL_LABEL: Record<string, string> = { none: "관계 없음", lover: "연인", engaged: "약혼", married: "결혼" };

function condSummary(e: CharEvent): string {
  const parts: string[] = [];
  if (e.trigger_affinity_min != null) parts.push(`호감도 ${e.trigger_affinity_min}+`);
  if (e.trigger_keywords) parts.push(`키워드: ${e.trigger_keywords}`);
  if (e.trigger_relationship) parts.push(`관계: ${REL_LABEL[e.trigger_relationship] ?? e.trigger_relationship}`);
  return parts.length ? parts.join(" / ") : "조건 없음";
}

/** 이벤트 채팅 설정 섹션: 발동 조건 + 상황/성공/실패 조건 + 보상(관계 설정) CRUD */
export default function CharacterEventsSection({
  characterId,
  onChanged,
  character,
  titleImageUrl,
  illusts,
  onIllustsChanged,
  genCost,
}: {
  characterId: string;
  onChanged?: () => void;
  character: { name: string; profile: string; personality: string };
  titleImageUrl?: string | null;
  /** 이 캐릭터의 일러스트 목록 ("달성 시 이미지" 선택용) */
  illusts: { id: number; description: string | null; url: string }[];
  onIllustsChanged?: () => void;
  /** AI 생성 비용(코인) — web 에서만 표시 */
  genCost?: number | null;
}) {
  const [genOpen, setGenOpen] = useState(false);
  const [list, setList] = useState<CharEvent[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const base = `/api/studio/characters/${characterId}/events`;

  const load = () =>
    studioFetch(base).then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const startEdit = (e: CharEvent) => {
    setEditId(e.id);
    setError("");
    setForm({
      name: e.name,
      trigger_affinity_min: e.trigger_affinity_min == null ? "" : String(e.trigger_affinity_min),
      trigger_keywords: e.trigger_keywords ?? "",
      trigger_relationship: e.trigger_relationship ?? "",
      situation: e.situation ?? "",
      success_condition: e.success_condition ?? "",
      fail_condition: e.fail_condition ?? "",
      set_relationship: e.set_relationship ?? "",
      retry_hours: String(e.retry_hours),
      max_turns: String(e.max_turns),
      is_active: !!e.is_active,
      success_line: e.success_line ?? "",
      success_illustration_id: e.success_illustration_id ? String(e.success_illustration_id) : "",
    });
  };

  const reset = () => {
    setEditId(null);
    setError("");
    setForm(EMPTY);
  };

  const save = async () => {
    setError("");
    const body = {
      name: form.name,
      trigger_affinity_min: form.trigger_affinity_min.trim() === "" ? null : Number(form.trigger_affinity_min),
      trigger_keywords: form.trigger_keywords,
      trigger_relationship: form.trigger_relationship || null,
      situation: form.situation,
      success_condition: form.success_condition,
      fail_condition: form.fail_condition,
      set_relationship: form.set_relationship || null,
      retry_hours: Number(form.retry_hours),
      max_turns: Number(form.max_turns),
      is_active: form.is_active,
      success_line: form.success_line.trim() || null,
      success_illustration_id: form.success_illustration_id ? Number(form.success_illustration_id) : null,
    };
    const r = await studioFetch(editId == null ? base : `${base}/${editId}`, {
      method: editId == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "저장 실패");
      return;
    }
    reset();
    load();
    onChanged?.();
  };

  /** 이벤트 달성 이미지 AI 생성 (저장 안 함) — dataURL 반환. 저장은 아래 saveSuccessImage 에서 */
  const generateSuccessImage = async (p: ImageGenPayload): Promise<string> => {
    if (editId == null) throw new Error("먼저 이벤트를 저장하세요.");
    const res = await studioFetch(`/api/studio/characters/${characterId}/illustrations/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: p.prompt,
        kind: "conditional",
        keywords: "",
        requireEventId: editId,
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

  /** 선택한 생성 결과를 달성 일러스트(조건부·이벤트 게이트)로 업로드 + 이벤트에 연결 */
  const saveSuccessImage = async (blob: Blob, filename: string) => {
    if (editId == null) throw new Error("먼저 이벤트를 저장하세요.");
    const fd = new FormData();
    fd.append("file", blob, filename);
    fd.append("kind", "conditional");
    fd.append("keywords", "");
    fd.append("requireEventId", String(editId));
    fd.append("description", `${form.name || "이벤트"} 달성 이미지`);
    const res = await studioFetch(`/api/studio/characters/${characterId}/illustrations`, { method: "POST", body: fd });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    onIllustsChanged?.();
    setForm((prev) => ({ ...prev, success_illustration_id: String(r.id) }));
  };

  const eventImageDesc = () =>
    buildImageDescription(
      `이벤트 달성 장면: ${form.name}
상황: ${form.situation.slice(0, 300)}
성공 조건: ${form.success_condition.slice(0, 200)}`
    );

  const remove = async (e: CharEvent) => {
    if (!confirm(`"${e.name}" 이벤트를 삭제할까요? 유저 달성 기록도 함께 삭제됩니다.`)) return;
    await studioFetch(`${base}/${e.id}`, { method: "DELETE" });
    if (editId === e.id) reset();
    load();
    onChanged?.();
  };

  return (
    <>
      <h3>이벤트 채팅 ({list.length})</h3>
      <div className="panel">
        <div className="notice">
          발동 조건(지정한 것만 모두 충족)이 맞으면 캐릭터가 지정한 상황을 연기하고, 매 턴 채점 LLM 이 성공/실패를 판정합니다.
          최대 턴을 넘기면 실패이며, 성공은 유저당 1회만 저장됩니다. 실패하면 재발동 텀이 지난 뒤 조건이 맞을 때 다시 발동합니다.
        </div>
        <div className="row">
          <div>
            <label>이름</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 첫 고백" />
          </div>
          <div>
            <label>발동: 호감도 최소</label>
            <input
              type="number"
              value={form.trigger_affinity_min}
              onChange={(e) => setForm({ ...form, trigger_affinity_min: e.target.value })}
              placeholder="빈값=조건 없음"
            />
          </div>
          <div>
            <label>발동: 키워드 (쉼표 구분)</label>
            <input
              value={form.trigger_keywords}
              onChange={(e) => setForm({ ...form, trigger_keywords: e.target.value })}
              placeholder="예: 사랑해, 좋아해"
            />
          </div>
          <div>
            <label>발동: 관계 조건</label>
            <select value={form.trigger_relationship} onChange={(e) => setForm({ ...form, trigger_relationship: e.target.value })}>
              <option value="">조건 없음</option>
              <option value="none">관계 없음일 때만</option>
              <option value="lover">연인일 때만</option>
              <option value="engaged">약혼일 때만</option>
              <option value="married">결혼일 때만</option>
            </select>
          </div>
        </div>
        <label>상황 지시</label>
        <textarea
          rows={3}
          value={form.situation}
          onChange={(e) => setForm({ ...form, situation: e.target.value })}
          placeholder="발동 시 캐릭터가 연기할 상황 (예: 해질녘 공원에서 떨리는 목소리로 고백을 준비한다)"
        />
        <label>성공 조건</label>
        <textarea
          rows={2}
          value={form.success_condition}
          onChange={(e) => setForm({ ...form, success_condition: e.target.value })}
          placeholder="채점 LLM 이 성공으로 판단할 기준"
        />
        <label>실패 조건 (선택)</label>
        <textarea
          rows={2}
          value={form.fail_condition}
          onChange={(e) => setForm({ ...form, fail_condition: e.target.value })}
          placeholder="비워두면 최대 턴 초과 시에만 실패"
        />
        <div className="row">
          <div>
            <label>성공 시 관계 설정</label>
            <select value={form.set_relationship} onChange={(e) => setForm({ ...form, set_relationship: e.target.value })}>
              <option value="">없음</option>
              <option value="lover">연인</option>
              <option value="engaged">약혼</option>
              <option value="married">결혼</option>
            </select>
          </div>
          <div>
            <label>재발동 텀 (시간, 1~720)</label>
            <input type="number" min={1} max={720} value={form.retry_hours} onChange={(e) => setForm({ ...form, retry_hours: e.target.value })} />
          </div>
          <div>
            <label>최대 턴 (1~20)</label>
            <input type="number" min={1} max={20} value={form.max_turns} onChange={(e) => setForm({ ...form, max_turns: e.target.value })} />
          </div>
          <div>
            <label>활성</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: "normal" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              사용
            </label>
          </div>
        </div>
        <label>달성 시 대사 (선택 — 비우면 출력 없음)</label>
        <textarea
          rows={2}
          value={form.success_line}
          onChange={(e) => setForm({ ...form, success_line: e.target.value })}
          placeholder="이벤트 성공 시 별도 말풍선으로 출력할 고정 대사"
        />
        <label>달성 시 이미지</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            style={{ flex: 1, minWidth: 200 }}
            value={form.success_illustration_id}
            onChange={(e) => setForm({ ...form, success_illustration_id: e.target.value })}
          >
            <option value="">없음</option>
            {illusts.map((i) => (
              <option key={i.id} value={i.id}>{i.description ? `${i.description} (#${i.id})` : `#${i.id}`}</option>
            ))}
          </select>
          <button type="button" className="small" disabled={editId == null} onClick={() => setGenOpen(true)}>
            이미지 AI 생성{genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
          </button>
          {editId == null && <span className="muted">먼저 저장하세요 (저장된 이벤트 수정 중에만 생성 가능)</span>}
        </div>
        <AiGenFlow
          open={genOpen}
          title="이벤트 달성 이미지 AI 생성"
          initialDescription={eventImageDesc()}
          initialProfile={buildProfileText(character)}
          titleImageUrl={titleImageUrl}
          submitSuffix={genCost != null ? ` (-${genCost.toLocaleString()}코인)` : ""}
          aspect="free"
          generate={generateSuccessImage}
          save={saveSuccessImage}
          onClose={() => setGenOpen(false)}
        />
        {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
        <button onClick={save}>{editId == null ? "이벤트 추가" : "수정 저장"}</button>{" "}
        {editId != null && <button className="small" onClick={reset}>취소</button>}

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr><th>이름</th><th>발동 조건</th><th>달성</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.name}
                  {e.success_line ? <span title="달성 대사 있음"> 💬</span> : null}
                  {e.success_illustration_id ? <span title="달성 이미지 있음"> 🖼</span> : null}
                </td>
                <td className="muted">{condSummary(e)}</td>
                <td>{Number(e.success_count ?? 0)}명</td>
                <td>{e.is_active ? <span className="badge">활성</span> : <span className="muted">비활성</span>}</td>
                <td>
                  <button className="small" onClick={() => startEdit(e)}>수정</button>{" "}
                  <button className="danger small" onClick={() => remove(e)}>삭제</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="muted">등록된 이벤트가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
