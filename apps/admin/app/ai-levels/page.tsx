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
interface Level {
  id: number;
  level: number;
  name: string;
  description: string | null;
  kind: "browser" | "server";
  chat_cost: number;
  is_default: number;
  is_active: number;
  assignments: Row[];
}

const EMPTY_FORM = { level: 2, name: "", description: "", kind: "server", chat_cost: 100 };
const JSON_HDR = { "Content-Type": "application/json" };

export default function AiLevelsPage() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [llms, setLlms] = useState<Llm[]>([]);
  const [rows, setRows] = useState<Record<number, Row[]>>({});
  const [form, setForm] = useState(EMPTY_FORM);
  // 레벨별 편집 중 값
  const [costs, setCosts] = useState<Record<number, number>>({});
  const [nums, setNums] = useState<Record<number, number>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});

  const load = async () => {
    const [t, l] = await Promise.all([
      fetch("/api/ai-levels").then((r) => r.json()),
      fetch("/api/llm").then((r) => r.json()),
    ]);
    setLevels(t);
    setLlms(l);
    setCosts(Object.fromEntries((t as Level[]).map((x) => [x.id, x.chat_cost])));
    setNums(Object.fromEntries((t as Level[]).map((x) => [x.id, x.level])));
    setRows(
      Object.fromEntries(
        (t as Level[]).map((x) => [
          x.id,
          x.assignments.map((a) => ({ llm_provider_id: a.llm_provider_id, weight: a.weight })),
        ])
      )
    );
  };
  useEffect(() => {
    load();
  }, []);

  const flash = (id: number, text: string) => {
    setMsg((m) => ({ ...m, [id]: text }));
    setTimeout(() => setMsg((m) => ({ ...m, [id]: "" })), 2000);
  };

  const create = async () => {
    if (!form.name.trim()) return;
    const r = await fetch("/api/ai-levels", {
      method: "POST",
      headers: JSON_HDR,
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      alert((await r.json()).error);
      return;
    }
    setForm(EMPTY_FORM);
    load();
  };

  const put = async (id: number, body: object, okText: string) => {
    const r = await fetch(`/api/ai-levels/${id}`, {
      method: "PUT",
      headers: JSON_HDR,
      body: JSON.stringify(body),
    });
    if (r.ok) {
      flash(id, okText);
      load();
    } else {
      flash(id, (await r.json()).error);
    }
  };

  const remove = async (l: Level) => {
    if (!confirm(`"${l.name}" 레벨을 삭제할까요?`)) return;
    const r = await fetch(`/api/ai-levels/${l.id}`, { method: "DELETE" });
    if (!r.ok) alert((await r.json()).error);
    load();
  };

  const setRow = (lid: number, idx: number, patch: Partial<Row>) =>
    setRows({ ...rows, [lid]: rows[lid].map((r, i) => (i === idx ? { ...r, ...patch } : r)) });

  const addRow = (lid: number) => {
    const used = new Set(rows[lid].map((r) => r.llm_provider_id));
    const next = llms.find((l) => !used.has(l.id));
    if (!next) return;
    setRows({ ...rows, [lid]: [...rows[lid], { llm_provider_id: next.id, weight: 1 }] });
  };

  const delRow = (lid: number, idx: number) =>
    setRows({ ...rows, [lid]: rows[lid].filter((_, i) => i !== idx) });

  const save = async (lid: number) => {
    const r = await fetch(`/api/ai-levels/${lid}/assignments`, {
      method: "PUT",
      headers: JSON_HDR,
      body: JSON.stringify({ assignments: rows[lid] }),
    });
    flash(lid, r.ok ? "저장됨 ✓" : (await r.json()).error);
    if (r.ok) load();
  };

  return (
    <>
      <h2>채팅 AI 레벨</h2>
      <p className="muted">
        유저가 채팅 화면에서 직접 선택하는 AI 레벨입니다. 채팅 1회 비용 = 레벨 비용 × (1 - 유저 등급 할인율).
      </p>
      <p className="muted">여러 개 할당 시 가중치 비율로 분배됩니다. off 된 LLM 은 자동 제외됩니다.</p>

      <h3>레벨 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>레벨 번호</label>
            <input type="number" min={0} value={form.level}
              onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} />
          </div>
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
          <div>
            <label>종류</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="server">서버 LLM</option>
              <option value="browser">브라우저 AI</option>
            </select>
          </div>
          <div>
            <label>1회 기본 비용(코인)</label>
            <input type="number" min={0} value={form.chat_cost}
              onChange={(e) => setForm({ ...form, chat_cost: Number(e.target.value) })} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={create}>추가</button>
        </div>
      </div>

      {levels.map((l) => {
        const tr = rows[l.id] ?? [];
        const total = tr.reduce((n, r) => n + (Number(r.weight) || 0), 0);
        return (
          <div className="panel" key={l.id}>
            <h3 style={{ margin: 0 }}>
              {l.name} <span className="badge">Lv.{l.level}</span>{" "}
              <span className="badge">{l.kind === "browser" ? "브라우저 AI" : "서버 LLM"}</span>{" "}
              {l.is_default ? <span className="badge">기본 레벨</span> : null}{" "}
              {!l.is_active && <span className="badge banned">비활성</span>}
            </h3>
            {l.description && <p className="muted">{l.description}</p>}

            <div className="row" style={{ alignItems: "flex-end", marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <label>레벨 번호</label>
                <input type="number" min={0} value={nums[l.id] ?? 0}
                  onChange={(e) => setNums({ ...nums, [l.id]: Number(e.target.value) })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>1회 기본 비용(코인)</label>
                <input type="number" min={0} value={costs[l.id] ?? 0}
                  onChange={(e) => setCosts({ ...costs, [l.id]: Number(e.target.value) })} />
              </div>
              <div style={{ flex: 0 }}>
                <button className="small"
                  onClick={() => put(l.id, { chat_cost: costs[l.id], level: nums[l.id] }, "저장됨 ✓")}>
                  저장
                </button>
              </div>
              <div style={{ flex: 3 }} />
            </div>

            {l.kind === "server" ? (
              <>
                {tr.map((r, idx) => {
                  const llm = llms.find((x) => x.id === r.llm_provider_id);
                  const pct = total > 0 ? Math.round(((Number(r.weight) || 0) / total) * 1000) / 10 : 0;
                  return (
                    <div className="row" key={idx} style={{ alignItems: "flex-end", marginTop: 6 }}>
                      <div style={{ flex: 3 }}>
                        <select value={r.llm_provider_id}
                          onChange={(e) => setRow(l.id, idx, { llm_provider_id: Number(e.target.value) })}>
                          {llms.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}{x.is_active ? "" : " (OFF)"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <input type="number" min={1} value={r.weight}
                          onChange={(e) => setRow(l.id, idx, { weight: Number(e.target.value) })} />
                      </div>
                      <div style={{ flex: 1 }} className="muted">
                        {pct}%{llm && !llm.is_active ? " (제외됨)" : ""}
                      </div>
                      <div style={{ flex: 0 }}>
                        <button className="small danger" onClick={() => delRow(l.id, idx)}>삭제</button>
                      </div>
                    </div>
                  );
                })}
                {tr.length === 0 && (
                  <p className="muted">할당된 LLM 없음 — 서버 환경변수 기반 기본 모델을 사용합니다.</p>
                )}
              </>
            ) : (
              <p className="muted">
                유저 PC 의 Chrome 내장 AI(Gemini Nano)를 사용합니다 — LLM 할당이 필요 없습니다.
              </p>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              {l.kind === "server" && (
                <>
                  <button className="small" onClick={() => addRow(l.id)}>+ 행 추가</button>
                  <button onClick={() => save(l.id)}>할당 저장</button>
                </>
              )}
              {!l.is_default && (
                <button className="small" onClick={() => put(l.id, { is_default: 1 }, "기본 레벨로 지정됨 ✓")}>
                  기본 레벨로 지정
                </button>
              )}
              <button className="small"
                onClick={() => put(l.id, { is_active: l.is_active ? 0 : 1 }, l.is_active ? "비활성화됨" : "활성화됨")}>
                {l.is_active ? "비활성으로" : "활성으로"}
              </button>
              {!l.is_default && (
                <button className="small danger" onClick={() => remove(l)}>레벨 삭제</button>
              )}
              <span className="muted">{msg[l.id]}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
