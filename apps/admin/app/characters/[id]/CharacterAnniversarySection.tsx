"use client";

import { useEffect, useState } from "react";

interface Anniv {
  id: number;
  name: string;
  month: number;
  day: number;
  description: string;
}

const EMPTY = { name: "", month: "", day: "", description: "" };
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

  const remove = async (a: Anniv) => {
    if (!confirm(`"${a.name}" 개인 기념일을 삭제할까요?`)) return;
    await fetch(`/api/anniversaries/${a.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h3>개인 기념일 ({list.length})</h3>
      <div className="panel">
        <div className="notice">이 캐릭터만 기억하는 날입니다. 당일과 7일 전부터 대화에 반영됩니다.</div>
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
            {list.map((a) => (
              <tr key={a.id}>
                <td>{mmdd(a.month, a.day)}</td>
                <td>{a.name}</td>
                <td>{a.description}</td>
                <td><button className="danger small" onClick={() => remove(a)}>삭제</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="muted">등록된 개인 기념일이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
