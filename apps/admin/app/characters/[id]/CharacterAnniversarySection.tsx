"use client";

import { useEffect, useState } from "react";

interface Anniv {
  id: number;
  name: string;
  month: number;
  day: number;
  notice_days?: number;
  description: string;
}

const EMPTY = { name: "", month: "", day: "", notice_days: "7", description: "" };
const noticeLabel = (n?: number) => ((n ?? 7) === 0 ? "당일만" : `D-${n ?? 7}부터`);
const mmdd = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 캐릭터 개인 기념일 섹션: 그 캐릭터만 기억하는 날 추가 + 목록/삭제 */
export default function CharacterAnniversarySection({ characterId }: { characterId: string }) {
  const [list, setList] = useState<Anniv[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const base = `/api/characters/${characterId}/anniversaries`;

  const load = () =>
    fetch(base).then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const add = async () => {
    setError("");
    const r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        month: Number(form.month),
        day: Number(form.day),
        notice_days: form.notice_days === "" ? 7 : Number(form.notice_days),
        description: form.description,
      }),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "저장 실패");
      return;
    }
    setForm(EMPTY);
    load();
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
    const r = await fetch(`/api/anniversaries/${editId}`, {
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
    if (!confirm(`"${a.name}" 개인 기념일을 삭제할까요?`)) return;
    await fetch(`/api/anniversaries/${a.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h3>개인 기념일 ({list.length})</h3>
      <div className="panel">
        <div className="notice">이 캐릭터만 기억하는 날입니다. 당일과 "언급 시작" 일수 전부터 대화에 반영됩니다.</div>
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
        <button onClick={add}>개인 기념일 추가</button>

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr><th>날짜</th><th>이름</th><th>설명</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((a) =>
              editId === a.id ? (
                <tr key={a.id}>
                  <td colSpan={4}>
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
                <td>
                  <button className="small" onClick={() => startEdit(a)}>편집</button>{" "}
                  <button className="danger small" onClick={() => remove(a)}>삭제</button>
                </td>
              </tr>
              )
            )}
            {list.length === 0 && <tr><td colSpan={4} className="muted">등록된 개인 기념일이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
