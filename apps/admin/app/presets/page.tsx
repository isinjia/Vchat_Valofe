"use client";

import { useEffect, useState } from "react";

interface Preset {
  id: number;
  name: string;
  month: number;
  day: number;
  notice_days?: number;
  duration_days?: number;
  description: string;
}

const EMPTY = { name: "", month: "", day: "", notice_days: "7", duration_days: "1", description: "" };
const noticeLabel = (n?: number) => ((n ?? 7) === 0 ? "당일만" : `D-${n ?? 7}부터`);
const durLabel = (n?: number) => ((n ?? 1) > 1 ? ` (${n}일간)` : "");
const mmdd = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

interface EditState {
  name: string;
  month: string;
  day: string;
  notice_days: string;
  duration_days: string;
  description: string;
}

export default function PresetsPage() {
  const [list, setList] = useState<Preset[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  // 편집 중인 프리셋 (한 번에 하나)
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditState>(EMPTY);
  const [editError, setEditError] = useState("");

  const load = async () => {
    const r = await fetch("/api/anniversary-presets");
    const d = await r.json();
    setList(Array.isArray(d) ? d : []);
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError("");
    const r = await fetch("/api/anniversary-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        month: Number(form.month),
        day: Number(form.day),
        notice_days: form.notice_days === "" ? 7 : Number(form.notice_days),
        duration_days: form.duration_days === "" ? 1 : Number(form.duration_days),
        description: form.description,
      }),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "생성 실패");
      return;
    }
    setForm(EMPTY);
    load();
  };

  const remove = async (p: Preset) => {
    if (!confirm(`"${p.name}" 프리셋을 삭제할까요? 이미 세계관에 불러온 기념일은 커스텀으로 남습니다.`)) return;
    await fetch(`/api/anniversary-presets/${p.id}`, { method: "DELETE" });
    load();
  };

  const startEdit = (p: Preset) => {
    setEditId(p.id);
    setEditError("");
    setEdit({
      name: p.name,
      month: String(p.month),
      day: String(p.day),
      notice_days: String(p.notice_days ?? 7),
      duration_days: String(p.duration_days ?? 1),
      description: p.description,
    });
  };

  const saveEdit = async () => {
    if (editId == null) return;
    setEditError("");
    const r = await fetch(`/api/anniversary-presets/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: edit.name,
        month: Number(edit.month),
        day: Number(edit.day),
        notice_days: edit.notice_days === "" ? 7 : Number(edit.notice_days),
        duration_days: edit.duration_days === "" ? 1 : Number(edit.duration_days),
        description: edit.description,
      }),
    });
    if (!r.ok) {
      setEditError((await r.json().catch(() => ({}))).error ?? "저장 실패");
      return;
    }
    setEditId(null);
    load();
  };

  return (
    <>
      <h2>기념일 프리셋</h2>

      <h3>프리셋 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>이름</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
          <div>
            <label title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)">기간(일)</label>
            <input type="number" min={1} max={60} value={form.duration_days} title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)" onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
          </div>
        </div>
        <label>설명 (어떤 날인지)</label>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button onClick={create}>추가</button>
        </div>
      </div>

      <h3>등록된 프리셋 ({list.length})</h3>
      <div className="panel">
        <table>
          <thead>
            <tr><th>날짜</th><th>이름</th><th>설명</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((p) =>
              editId === p.id ? (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <input type="number" min={1} max={12} value={edit.month} style={{ width: 62, display: "inline-block" }}
                      onChange={(e) => setEdit({ ...edit, month: e.target.value })} />{" "}
                    /
                    <input type="number" min={1} max={31} value={edit.day} style={{ width: 62, display: "inline-block", marginLeft: 4 }}
                      onChange={(e) => setEdit({ ...edit, day: e.target.value })} />
                    <div style={{ marginTop: 4 }}>
                      <span className="muted">D-</span>
                      <input type="number" min={0} max={365} value={edit.notice_days} style={{ width: 62, display: "inline-block" }}
                        onChange={(e) => setEdit({ ...edit, notice_days: e.target.value })}
                        title="기념일 N일 전부터 대화에서 언급 (0=당일만)" />
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span className="muted">기간</span>
                      <input type="number" min={1} max={60} value={edit.duration_days} style={{ width: 62, display: "inline-block" }}
                        onChange={(e) => setEdit({ ...edit, duration_days: e.target.value })}
                        title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)" />
                      <span className="muted">일</span>
                    </div>
                  </td>
                  <td>
                    <input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  </td>
                  <td>
                    <textarea rows={2} value={edit.description} style={{ minHeight: 48 }}
                      onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                    {editError && <div style={{ color: "var(--danger)", marginTop: 4 }}>{editError}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="small" onClick={saveEdit}>저장</button>{" "}
                    <button className="small btn-secondary" onClick={() => setEditId(null)}>취소</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td>{mmdd(p.month, p.day)}{durLabel(p.duration_days)} <span className="muted">({noticeLabel(p.notice_days)})</span></td>
                  <td>{p.name}</td>
                  <td>{p.description}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="small" onClick={() => startEdit(p)}>편집</button>{" "}
                    <button className="small danger" onClick={() => remove(p)}>삭제</button>
                  </td>
                </tr>
              )
            )}
            {list.length === 0 && <tr><td colSpan={4} className="muted">등록된 프리셋이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
