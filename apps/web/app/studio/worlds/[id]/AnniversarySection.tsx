"use client";

import { useEffect, useState } from "react";
import { studioFetch } from "../../studio-api";

interface Preset {
  id: number;
  name: string;
  month: number;
  day: number;
  notice_days?: number;
  description: string;
}

interface Anniv {
  id: number;
  preset_id: number | null;
  preset_name: string | null;
  name: string;
  month: number;
  day: number;
  notice_days?: number;
  description: string;
}

const EMPTY = { name: "", month: "", day: "", notice_days: "7", description: "" };
const noticeLabel = (n?: number) => ((n ?? 7) === 0 ? "당일만" : `D-${n ?? 7}부터`);
const mmdd = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 세계관 기념일 섹션: 프리셋 불러오기(스냅샷 복사) + 커스텀 추가 + 목록/삭제 */
export default function AnniversarySection({ worldId }: { worldId: string }) {
  const [list, setList] = useState<Anniv[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const base = `/api/studio/worlds/${worldId}/anniversaries`;

  const load = () =>
    studioFetch(base).then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    load();
    studioFetch("/api/studio/anniversary-presets").then((r) => r.json()).then((d) => setPresets(Array.isArray(d) ? d : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  const loaded = new Set(list.map((a) => a.preset_id).filter((v): v is number => v != null));

  const post = async (body: unknown) => {
    setError("");
    const r = await studioFetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "저장 실패");
      return false;
    }
    load();
    return true;
  };

  const importPreset = async () => {
    if (!presetId) return;
    if (await post({ preset_id: Number(presetId) })) setPresetId("");
  };

  const addCustom = async () => {
    const ok = await post({
      name: form.name,
      month: Number(form.month),
      day: Number(form.day),
      notice_days: form.notice_days === "" ? 7 : Number(form.notice_days),
      description: form.description,
    });
    if (ok) setForm(EMPTY);
  };

  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [editError, setEditError] = useState("");

  const startEdit = (a: Anniv) => {
    setEditId(a.id);
    setEditError("");
    setEditForm({
      name: a.name,
      month: String(a.month),
      day: String(a.day),
      notice_days: String(a.notice_days ?? 7),
      description: a.description ?? "",
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditError("");
  };

  const saveEdit = async () => {
    if (editId == null) return;
    setEditError("");
    const r = await studioFetch(`${base}/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        month: Number(editForm.month),
        day: Number(editForm.day),
        notice_days: editForm.notice_days === "" ? 7 : Number(editForm.notice_days),
        description: editForm.description,
      }),
    });
    if (!r.ok) {
      setEditError((await r.json().catch(() => ({}))).error ?? "저장 실패");
      return;
    }
    setEditId(null);
    load();
  };

  const remove = async (a: Anniv) => {
    if (!confirm(`"${a.name}" 기념일을 삭제할까요?`)) return;
    await studioFetch(`${base}/${a.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h3>기념일 ({list.length})</h3>
      <div className="panel">
        <div className="notice">기념일 당일과 각 기념일의 "언급 시작" 일수 전부터 캐릭터가 대화에서 자연스럽게 언급합니다.</div>

        <label>프리셋에서 불러오기</label>
        <div className="row">
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            <option value="">프리셋 선택</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id} disabled={loaded.has(p.id)}>
                {mmdd(p.month, p.day)} {p.name}
                {loaded.has(p.id) ? " (불러옴)" : ""}
              </option>
            ))}
          </select>
          <div>
            <button onClick={importPreset} disabled={!presetId}>불러오기</button>
          </div>
        </div>

        <label style={{ marginTop: 12 }}>커스텀 기념일 추가</label>
        <div className="row">
          <div>
            <label>이름</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>월 (1~12)</label>
            <input type="number" min={1} max={12} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </div>
          <div>
            <label>일 (1~31)</label>
            <input type="number" min={1} max={31} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
          </div>
          <div>
            <label>언급 시작(일 전)</label>
            <input type="number" min={0} max={365} value={form.notice_days} onChange={(e) => setForm({ ...form, notice_days: e.target.value })} />
            <div className="muted">N일 전부터 대화에서 언급 (0=당일만)</div>
          </div>
        </div>
        <label>설명</label>
        <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
        <button onClick={addCustom}>기념일 추가</button>

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr><th>날짜</th><th>이름</th><th>설명</th><th>출처</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((a) =>
              editId === a.id ? (
                <tr key={a.id}>
                  <td colSpan={5}>
                    <div className="row">
                      <div>
                        <label>이름</label>
                        <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                      </div>
                      <div>
                        <label>월 (1~12)</label>
                        <input type="number" min={1} max={12} value={editForm.month} onChange={(e) => setEditForm({ ...editForm, month: e.target.value })} />
                      </div>
                      <div>
                        <label>일 (1~31)</label>
                        <input type="number" min={1} max={31} value={editForm.day} onChange={(e) => setEditForm({ ...editForm, day: e.target.value })} />
                      </div>
                      <div>
                        <label>언급 시작(일 전)</label>
                        <input type="number" min={0} max={365} value={editForm.notice_days} onChange={(e) => setEditForm({ ...editForm, notice_days: e.target.value })} />
                      </div>
                    </div>
                    <label>설명</label>
                    <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                    {editError && <p style={{ color: "var(--danger)", marginTop: 8 }}>{editError}</p>}
                    <button onClick={saveEdit}>저장</button>{" "}
                    <button className="small" onClick={cancelEdit}>취소</button>
                  </td>
                </tr>
              ) : (
              <tr key={a.id}>
                <td>{mmdd(a.month, a.day)} <span className="muted">({noticeLabel(a.notice_days)})</span></td>
                <td>{a.name}</td>
                <td>{a.description}</td>
                <td>{a.preset_id != null ? <span className="muted">{a.preset_name ?? "프리셋"}</span> : <span className="badge cond">커스텀</span>}</td>
                <td>
                  <button className="small" onClick={() => startEdit(a)}>편집</button>{" "}
                  <button className="danger small" onClick={() => remove(a)}>삭제</button>
                </td>
              </tr>
              )
            )}
            {list.length === 0 && <tr><td colSpan={5} className="muted">등록된 기념일이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
