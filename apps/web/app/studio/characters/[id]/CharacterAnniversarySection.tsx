"use client";

import { useEffect, useState } from "react";
import { studioFetch } from "../../studio-api";

interface Anniv {
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

type OverrideState = { skip: boolean; description: string };

/** 캐릭터 개인 기념일 섹션: 그 캐릭터만 기억하는 날 추가 + 목록/삭제 + 공유 기념일 오버라이드 */
export default function CharacterAnniversarySection({ characterId }: { characterId: string }) {
  const [list, setList] = useState<Anniv[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  // 세계관 공유 기념일 + 캐릭터별 오버라이드 (적용 안 함 / 설명 덮어쓰기)
  const [shared, setShared] = useState<Anniv[]>([]);
  const [ov, setOv] = useState<Record<number, OverrideState>>({});
  const [ovDirty, setOvDirty] = useState(false);
  const [ovError, setOvError] = useState("");
  const [ovSaving, setOvSaving] = useState(false);

  const base = `/api/studio/characters/${characterId}/anniversaries`;
  const ovBase = `/api/studio/characters/${characterId}/anniversary-overrides`;

  const load = () =>
    studioFetch(base).then((r) => r.json()).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});

  const loadOverrides = () =>
    studioFetch(ovBase)
      .then((r) => r.json())
      .then((d) => {
        setShared(Array.isArray(d.shared) ? d.shared : []);
        const next: Record<number, OverrideState> = {};
        for (const o of Array.isArray(d.overrides) ? d.overrides : []) {
          next[o.anniversary_id] = { skip: o.mode === "skip", description: o.description ?? "" };
        }
        setOv(next);
        setOvDirty(false);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    loadOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const setOverride = (id: number, patch: Partial<OverrideState>) => {
    setOv((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { skip: false, description: "" }), ...patch } }));
    setOvDirty(true);
  };

  const saveOverrides = async () => {
    setOvError("");
    setOvSaving(true);
    try {
      const overrides = shared.map((s) => ({
        anniversary_id: s.id,
        skip: ov[s.id]?.skip === true,
        description: ov[s.id]?.description ?? "",
      }));
      const r = await studioFetch(ovBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!r.ok) {
        setOvError((await r.json().catch(() => ({}))).error ?? "저장 실패");
        return;
      }
      loadOverrides();
    } finally {
      setOvSaving(false);
    }
  };

  const add = async () => {
    setError("");
    const r = await studioFetch(base, {
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
    const r = await studioFetch(`${base}/${editId}`, {
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
    if (!confirm(`"${a.name}" 개인 기념일을 삭제할까요?`)) return;
    await studioFetch(`${base}/${a.id}`, { method: "DELETE" });
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
          <div>
            <label title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)">기간(일)</label>
            <input type="number" min={1} max={60} value={form.duration_days} title="시작일부터 며칠간 이어지는 기념일인지 (기본 1일)" onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
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

      <h3>세계관 공유 기념일 ({shared.length})</h3>
      <div className="panel">
        <div className="notice">
          세계관에 등록된 공유 기념일입니다. 이 캐릭터만 적용을 끄거나, 설명(태도)을 캐릭터 시점으로 덮어쓸 수
          있습니다. 날짜·이름은 공유값을 그대로 따릅니다.
        </div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr><th>날짜</th><th>이름</th><th>기본 설명</th><th style={{ width: "40%" }}>이 캐릭터 설정</th></tr>
          </thead>
          <tbody>
            {shared.map((s) => {
              const o = ov[s.id] ?? { skip: false, description: "" };
              return (
                <tr key={s.id} style={o.skip ? { opacity: 0.55 } : undefined}>
                  <td>{mmdd(s.month, s.day)}{durLabel(s.duration_days)} <span className="muted">({noticeLabel(s.notice_days)})</span></td>
                  <td>{s.name}</td>
                  <td className="muted">{s.description}</td>
                  <td>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        checked={o.skip}
                        onChange={(e) => setOverride(s.id, { skip: e.target.checked })}
                      />
                      이 캐릭터에 적용 안 함
                    </label>
                    <textarea
                      rows={2}
                      value={o.description}
                      disabled={o.skip}
                      placeholder="설명 덮어쓰기 — 비우면 기본 설명 그대로"
                      onChange={(e) => setOverride(s.id, { description: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
            {shared.length === 0 && <tr><td colSpan={4} className="muted">세계관에 공유 기념일이 없습니다.</td></tr>}
          </tbody>
        </table>
        {ovError && <p style={{ color: "var(--danger)", marginTop: 8 }}>{ovError}</p>}
        {shared.length > 0 && (
          <button onClick={saveOverrides} disabled={!ovDirty || ovSaving}>
            {ovSaving ? "저장 중..." : ovDirty ? "공유 기념일 설정 저장" : "저장됨"}
          </button>
        )}
      </div>
    </>
  );
}
