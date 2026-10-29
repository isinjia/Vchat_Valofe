"use client";

import { useEffect, useState } from "react";

interface Preset {
  id: number;
  name: string;
  month: number;
  day: number;
  description: string;
}

const EMPTY = { name: "", month: "", day: "", description: "" };
const mmdd = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function PresetsPage() {
  const [list, setList] = useState<Preset[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

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
            {list.map((p) => (
              <tr key={p.id}>
                <td>{mmdd(p.month, p.day)}</td>
                <td>{p.name}</td>
                <td>{p.description}</td>
                <td><button className="small danger" onClick={() => remove(p)}>삭제</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="muted">등록된 프리셋이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
