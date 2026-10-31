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

interface Anniv {
  id: number;
  preset_id: number | null;
  preset_name: string | null;
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

/** 세계관 기념일 섹션: 프리셋 불러오기(스냅샷 복사) + 커스텀 추가 + 목록/삭제 */
export default function AnniversarySection({ worldId }: { worldId: string }) {
  const [list, setList] = useState<Anniv[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const base = `/api/worlds/${worldId}/anniversaries`;

  const load = () =>
    fetch(base).then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    load();
    fetch("/api/anniversary-presets").then((r) => r.json()).then((d) => setPresets(Array.isArray(d) ? d : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  const loaded = new Set(list.map((a) => a.preset_id).filter((v): v is number => v != null));

  const post = async (body: unknown) => {
    setError("");
    const r = await fetch(base, {
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

  // 프리셋 다중 선택 불러오기 다이얼로그
  const [presetOpen, setPresetOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const toggleChecked = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importChecked = async () => {
    if (checked.size === 0 || importing) return;
    setImporting(true);
    setImportError("");
    const failed: string[] = [];
    for (const pid of checked) {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: pid }),
      });
      if (!r.ok) {
        const name = presets.find((p) => p.id === pid)?.name ?? `#${pid}`;
        failed.push(name);
      }
    }
    setImporting(false);
    await load();
    if (failed.length > 0) {
      setImportError(`불러오지 못한 프리셋: ${failed.join(", ")}`);
      setChecked(new Set());
      return;
    }
    setChecked(new Set());
    setPresetOpen(false);
  };

  const addCustom = async () => {
    const ok = await post({
      name: form.name,
      month: Number(form.month),
      day: Number(form.day),
      notice_days: form.notice_days === "" ? 7 : Number(form.notice_days),
      duration_days: form.duration_days === "" ? 1 : Number(form.duration_days),
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
      duration_days: String(a.duration_days ?? 1),
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
        duration_days: editForm.duration_days === "" ? 1 : Number(editForm.duration_days),
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
    await fetch(`/api/anniversaries/${a.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h3>기념일 ({list.length})</h3>
      <div className="panel">
        <div className="notice">기념일 당일과 각 기념일의 "언급 시작" 일수 전부터 캐릭터가 대화에서 자연스럽게 언급합니다.</div>

        <label>프리셋에서 불러오기</label>
        <div>
          <button
            type="button"
            onClick={() => {
              setChecked(new Set());
              setImportError("");
              setPresetOpen(true);
            }}
          >
            프리셋 골라서 불러오기{presets.length > 0 ? ` (${presets.length}개)` : ""}
          </button>
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
          <div>
            <label title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)">기간(일)</label>
            <input type="number" min={1} max={60} value={form.duration_days} title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)" onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
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
                      <div>
                        <label title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)">기간(일)</label>
                        <input type="number" min={1} max={60} value={editForm.duration_days} title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)" onChange={(e) => setEditForm({ ...editForm, duration_days: e.target.value })} />
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
                <td>{mmdd(a.month, a.day)}{durLabel(a.duration_days)} <span className="muted">({noticeLabel(a.notice_days)})</span></td>
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

      {presetOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !importing) setPresetOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
            <h3>기념일 프리셋 불러오기</h3>
            <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
              체크한 프리셋을 한 번에 불러옵니다. 이미 불러온 프리셋은 선택할 수 없습니다.
            </p>
            <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: "4px 10px" }}>
              {presets.map((p) => {
                const done = loaded.has(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "8px 2px",
                      borderBottom: "1px solid var(--border)",
                      opacity: done ? 0.5 : 1,
                      cursor: done ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto", margin: "3px 0 0" }}
                      checked={done || checked.has(p.id)}
                      disabled={done || importing}
                      onChange={() => toggleChecked(p.id)}
                    />
                    <span style={{ flex: 1 }}>
                      <b>{p.name}</b>{" "}
                      <span className="muted" style={{ fontSize: 12 }}>
                        {mmdd(p.month, p.day)}{durLabel(p.duration_days)} · {noticeLabel(p.notice_days)}
                        {done ? " · 불러옴" : ""}
                      </span>
                      <span className="muted" style={{ display: "block", fontSize: 12, lineHeight: 1.5 }}>
                        {p.description}
                      </span>
                    </span>
                  </label>
                );
              })}
              {presets.length === 0 && <p className="muted">등록된 프리셋이 없습니다.</p>}
            </div>
            {importError && <p style={{ color: "var(--danger)", marginTop: 8 }}>{importError}</p>}
            <div className="crop-actions">
              <button
                type="button"
                className="btn-secondary small"
                disabled={importing}
                onClick={() => {
                  const all = new Set(presets.filter((p) => !loaded.has(p.id)).map((p) => p.id));
                  setChecked(checked.size === all.size ? new Set() : all);
                }}
              >
                전체 선택/해제
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-secondary" onClick={() => setPresetOpen(false)} disabled={importing}>
                닫기
              </button>
              <button type="button" onClick={importChecked} disabled={importing || checked.size === 0}>
                {importing ? "불러오는 중..." : `선택 ${checked.size}개 불러오기`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
