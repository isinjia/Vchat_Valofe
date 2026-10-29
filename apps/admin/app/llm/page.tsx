"use client";

import { useEffect, useState } from "react";

interface Llm {
  id: number;
  name: string;
  provider: "anthropic" | "openai_compatible";
  model: string;
  api_key: string | null; // 서버에서 마스킹되어 내려옴
  base_url: string | null;
  max_tokens: number;
  is_active: number;
}

const EMPTY = {
  name: "",
  provider: "anthropic" as Llm["provider"],
  model: "",
  api_key: "",
  base_url: "",
  max_tokens: 4096,
};

export default function LlmPage() {
  const [list, setList] = useState<Llm[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const load = async () => {
    const r = await fetch("/api/llm");
    setList(await r.json());
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError("");
    const r = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      setError((await r.json()).error ?? "생성 실패");
      return;
    }
    setForm(EMPTY);
    load();
  };

  // 마스킹된 api_key 를 되돌려보내지 않도록 __KEEP__ 전송
  const toggle = async (l: Llm) => {
    await fetch(`/api/llm/${l.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: l.is_active ? 0 : 1, api_key: "__KEEP__" }),
    });
    load();
  };

  const remove = async (l: Llm) => {
    if (!confirm(`"${l.name}" 을(를) 삭제할까요? 등급 할당도 함께 제거됩니다.`)) return;
    await fetch(`/api/llm/${l.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h2>LLM 관리</h2>

      <h3>LLM 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>표시명</label>
            <input type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Provider</label>
            <select value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value as Llm["provider"] })}>
              <option value="anthropic">Anthropic</option>
              <option value="openai_compatible">OpenAI 호환 (DeepSeek, Kimi 등)</option>
            </select>
          </div>
          <div>
            <label>모델</label>
            <input type="text" value={form.model} placeholder="claude-opus-5-5"
              onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>API Key</label>
            <input type="password" value={form.api_key}
              placeholder={form.provider === "anthropic" ? "비우면 서버 환경변수 사용" : ""}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </div>
          {form.provider === "openai_compatible" && (
            <div>
              <label>Base URL</label>
              <input type="text" value={form.base_url} placeholder="https://api.deepseek.com/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </div>
          )}
          <div>
            <label>최대 응답 토큰</label>
            <input type="number" value={form.max_tokens}
              onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
          </div>
        </div>
        {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button onClick={create}>추가</button>
        </div>
      </div>

      <h3>등록된 LLM</h3>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>Provider</th>
              <th>모델</th>
              <th>API Key</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.provider}</td>
                <td>
                  {l.model}
                  {l.base_url && <div className="muted">{l.base_url}</div>}
                </td>
                <td className="muted">{l.api_key ?? "-"}</td>
                <td>
                  <button className={`small${l.is_active ? "" : " danger"}`} onClick={() => toggle(l)}>
                    {l.is_active ? "ON" : "OFF"}
                  </button>
                </td>
                <td>
                  <button className="small danger" onClick={() => remove(l)}>삭제</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">등록된 LLM 이 없습니다. 등급에 할당이 없으면 서버 환경변수 기반 기본 모델을 사용합니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
