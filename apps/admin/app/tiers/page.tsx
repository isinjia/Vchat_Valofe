"use client";

import { useEffect, useState } from "react";

interface Llm {
  id: number;
  name: string;
  is_active: number;
}
interface Row {
  llm_provider_id: number;
  weight: number;
}
interface Tier {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  chat_cost: number;
  assignments: Row[];
}

export default function TiersPage() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [llms, setLlms] = useState<Llm[]>([]);
  // 등급별 편집 중인 할당 행
  const [rows, setRows] = useState<Record<number, Row[]>>({});
  const [form, setForm] = useState({ name: "", description: "" });
  // 등급별 채팅 1회 비용 (편집 중 값)
  const [costs, setCosts] = useState<Record<number, number>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});

  const load = async () => {
    const [t, l] = await Promise.all([
      fetch("/api/tiers").then((r) => r.json()),
      fetch("/api/llm").then((r) => r.json()),
    ]);
    setTiers(t);
    setLlms(l);
    setCosts(Object.fromEntries((t as Tier[]).map((x) => [x.id, x.chat_cost])));
    setRows(
      Object.fromEntries(
        (t as Tier[]).map((x) => [
          x.id,
          x.assignments.map((a) => ({ llm_provider_id: a.llm_provider_id, weight: a.weight })),
        ])
      )
    );
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!form.name.trim()) return;
    await fetch("/api/tiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", description: "" });
    load();
  };

  const remove = async (t: Tier) => {
    if (!confirm(`"${t.name}" 등급을 삭제할까요?`)) return;
    const r = await fetch(`/api/tiers/${t.id}`, { method: "DELETE" });
    if (!r.ok) alert((await r.json()).error);
    load();
  };

  const makeDefault = async (t: Tier) => {
    await fetch(`/api/tiers/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: 1 }),
    });
    load();
  };

  const setRow = (tid: number, idx: number, patch: Partial<Row>) =>
    setRows({ ...rows, [tid]: rows[tid].map((r, i) => (i === idx ? { ...r, ...patch } : r)) });

  const addRow = (tid: number) => {
    const used = new Set(rows[tid].map((r) => r.llm_provider_id));
    const next = llms.find((l) => !used.has(l.id));
    if (!next) return;
    setRows({ ...rows, [tid]: [...rows[tid], { llm_provider_id: next.id, weight: 1 }] });
  };

  const delRow = (tid: number, idx: number) =>
    setRows({ ...rows, [tid]: rows[tid].filter((_, i) => i !== idx) });

  const saveCost = async (tid: number) => {
    const r = await fetch(`/api/tiers/${tid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_cost: costs[tid] }),
    });
    const text = r.ok ? "비용 저장됨 ✓" : (await r.json()).error;
    setMsg((m) => ({ ...m, [tid]: text }));
    setTimeout(() => setMsg((m) => ({ ...m, [tid]: "" })), 2000);
    if (r.ok) load();
  };

  const save = async (tid: number) => {
    const r = await fetch(`/api/tiers/${tid}/assignments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: rows[tid] }),
    });
    const text = r.ok ? "저장됨 ✓" : (await r.json()).error;
    setMsg((m) => ({ ...m, [tid]: text }));
    setTimeout(() => setMsg((m) => ({ ...m, [tid]: "" })), 2000);
    if (r.ok) load();
  };

  return (
    <>
      <h2>채팅 등급</h2>
      <p className="muted">
        여러 개 할당 시 가중치 비율로 분배됩니다. off 된 LLM 은 자동 제외됩니다.
      </p>

      <h3>등급 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>이름</label>
            <input type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>설명</label>
            <input type="text" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={create}>추가</button>
        </div>
      </div>

      {tiers.map((t) => {
        const tr = rows[t.id] ?? [];
        const total = tr.reduce((n, r) => n + (Number(r.weight) || 0), 0);
        return (
          <div className="panel" key={t.id}>
            <h3 style={{ margin: 0 }}>
              {t.name} {t.is_default ? <span className="badge">기본 등급</span> : null}
            </h3>
            {t.description && <p className="muted">{t.description}</p>}

            <div className="row" style={{ alignItems: "flex-end", marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <label>채팅 1회 비용(코인)</label>
                <input type="number" min={0} value={costs[t.id] ?? 0}
                  onChange={(e) => setCosts({ ...costs, [t.id]: Number(e.target.value) })} />
              </div>
              <div style={{ flex: 0 }}>
                <button className="small" onClick={() => saveCost(t.id)}>비용 저장</button>
              </div>
              <div style={{ flex: 3 }} />
            </div>

            {tr.map((r, idx) => {
              const llm = llms.find((l) => l.id === r.llm_provider_id);
              const pct = total > 0 ? Math.round(((Number(r.weight) || 0) / total) * 1000) / 10 : 0;
              return (
                <div className="row" key={idx} style={{ alignItems: "flex-end", marginTop: 6 }}>
                  <div style={{ flex: 3 }}>
                    <select value={r.llm_provider_id}
                      onChange={(e) => setRow(t.id, idx, { llm_provider_id: Number(e.target.value) })}>
                      {llms.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}{l.is_active ? "" : " (OFF)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <input type="number" min={1} value={r.weight}
                      onChange={(e) => setRow(t.id, idx, { weight: Number(e.target.value) })} />
                  </div>
                  <div style={{ flex: 1 }} className="muted">
                    {pct}%{llm && !llm.is_active ? " (제외됨)" : ""}
                  </div>
                  <div style={{ flex: 0 }}>
                    <button className="small danger" onClick={() => delRow(t.id, idx)}>삭제</button>
                  </div>
                </div>
              );
            })}
            {tr.length === 0 && (
              <p className="muted">할당된 LLM 없음 — 서버 환경변수 기반 기본 모델을 사용합니다.</p>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <button className="small" onClick={() => addRow(t.id)}>+ 행 추가</button>
              <button onClick={() => save(t.id)}>할당 저장</button>
              {!t.is_default && (
                <>
                  <button className="small" onClick={() => makeDefault(t)}>기본 등급으로 지정</button>
                  <button className="small danger" onClick={() => remove(t)}>등급 삭제</button>
                </>
              )}
              <span className="muted">{msg[t.id]}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
