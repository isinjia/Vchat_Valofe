"use client";

import { Fragment, useEffect, useState } from "react";

interface Account {
  id: number;
  label: string;
  api_key: string | null; // 마스킹됨
  monthly_token_limit: number;
  is_active: number;
  input_tokens: number;
  output_tokens: number;
}

const EMPTY_ACC = { label: "", api_key: "", monthly_token_limit: 0 };

interface Llm {
  account_count: number;
  id: number;
  name: string;
  provider: "anthropic" | "openai_compatible";
  model: string;
  api_key: string | null; // 서버에서 마스킹되어 내려옴
  base_url: string | null;
  max_tokens: number;
  is_active: number;
  cost_per_1m_input: number | string;
  cost_per_1m_output: number | string;
  cost_currency: string;
  /** 이 LLM 을 사용하는 AI 레벨들 */
  ai_levels?: { level: number; name: string; is_active: number }[];
}

interface CostProv {
  id: number; inputTokens: number; outputTokens: number; cost: number; currency: string;
}

const EMPTY = {
  name: "",
  provider: "anthropic" as Llm["provider"],
  model: "",
  api_key: "",
  base_url: "",
  max_tokens: 4096,
  cost_per_1m_input: 0,
  cost_per_1m_output: 0,
  cost_currency: "USD",
};

export default function LlmPage() {
  const [tab, setTab] = useState<"chat" | "image">("chat");
  return (
    <>
      <h2>LLM 관리</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button style={{ marginTop: 0, opacity: tab === "chat" ? 1 : 0.5 }} onClick={() => setTab("chat")}>
          채팅 LLM
        </button>
        <button style={{ marginTop: 0, opacity: tab === "image" ? 1 : 0.5 }} onClick={() => setTab("image")}>
          이미지 생성 AI
        </button>
      </div>
      {tab === "chat" ? <ChatLlmTab /> : <ImageProviderTab />}
    </>
  );
}

function ChatLlmTab() {
  const [usage, setUsage] = useState<Record<number, CostProv>>({});
  const [editCostId, setEditCostId] = useState<number | null>(null);
  const [costForm, setCostForm] = useState({ cost_per_1m_input: 0, cost_per_1m_output: 0, cost_currency: "USD" });
  const [list, setList] = useState<Llm[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accForm, setAccForm] = useState(EMPTY_ACC);
  const [accError, setAccError] = useState("");

  const load = async () => {
    const r = await fetch("/api/llm");
    setList(await r.json());
    fetch("/api/stats/cost")
      .then((x) => x.json())
      .then((d: { providers: CostProv[] }) => {
        const m: Record<number, CostProv> = {};
        for (const p of d.providers ?? []) m[p.id] = p;
        setUsage(m);
      })
      .catch(() => {});
  };

  const startEditCost = (l: Llm) => {
    if (editCostId === l.id) {
      setEditCostId(null);
      return;
    }
    setEditCostId(l.id);
    setCostForm({
      cost_per_1m_input: Number(l.cost_per_1m_input),
      cost_per_1m_output: Number(l.cost_per_1m_output),
      cost_currency: l.cost_currency || "USD",
    });
  };

  const saveCost = async (l: Llm) => {
    await fetch(`/api/llm/${l.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...costForm, api_key: "__KEEP__" }),
    });
    setEditCostId(null);
    load();
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

  const loadAccounts = async (id: number) => {
    const r = await fetch(`/api/llm/${id}/accounts`);
    setAccounts(r.ok ? await r.json() : []);
  };

  const toggleAccounts = async (l: Llm) => {
    if (openId === l.id) {
      setOpenId(null);
      return;
    }
    setOpenId(l.id);
    setAccounts([]);
    setAccForm(EMPTY_ACC);
    setAccError("");
    await loadAccounts(l.id);
  };

  const addAccount = async () => {
    if (openId == null) return;
    setAccError("");
    const r = await fetch(`/api/llm/${openId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accForm),
    });
    if (!r.ok) {
      setAccError((await r.json()).error ?? "계정 추가 실패");
      return;
    }
    setAccForm(EMPTY_ACC);
    await loadAccounts(openId);
    load();
  };

  const toggleAccount = async (a: Account) => {
    await fetch(`/api/llm/accounts/${a.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: a.is_active ? 0 : 1, api_key: "__KEEP__" }),
    });
    if (openId != null) loadAccounts(openId);
  };

  const removeAccount = async (a: Account) => {
    if (!confirm(`계정 "${a.label}" 을(를) 삭제할까요? 사용량 기록도 함께 삭제됩니다.`)) return;
    await fetch(`/api/llm/accounts/${a.id}`, { method: "DELETE" });
    if (openId != null) await loadAccounts(openId);
    load();
  };

  const remove = async (l: Llm) => {
    if (!confirm(`"${l.name}" 을(를) 삭제할까요? 등급 할당도 함께 제거됩니다.`)) return;
    await fetch(`/api/llm/${l.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
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
              <input type="text" value={form.base_url} placeholder="https://api.deepseek.com/v1 또는 http://127.0.0.1:8600/v1 (로컬 대기열)"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </div>
          )}
          <div>
            <label>최대 응답 토큰</label>
            <input type="number" value={form.max_tokens}
              onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>입력 1M토큰당 비용</label>
            <input type="number" min={0} step="any" value={form.cost_per_1m_input}
              onChange={(e) => setForm({ ...form, cost_per_1m_input: Number(e.target.value) })} />
          </div>
          <div>
            <label>출력 1M토큰당 비용</label>
            <input type="number" min={0} step="any" value={form.cost_per_1m_output}
              onChange={(e) => setForm({ ...form, cost_per_1m_output: Number(e.target.value) })} />
          </div>
          <div>
            <label>통화</label>
            <input type="text" value={form.cost_currency} placeholder="USD"
              onChange={(e) => setForm({ ...form, cost_currency: e.target.value })} />
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
              <Fragment key={l.id}>
              <tr>
                <td>{l.name}</td>
                <td>{l.provider}</td>
                <td>
                  {l.model}
                  {l.base_url && <div className="muted">{l.base_url}</div>}
                  <div className="muted">
                    {(() => {
                      const u = usage[l.id];
                      const k = (n: number) => `${Math.round(n / 1000).toLocaleString("en-US")}k`;
                      return u
                        ? `이번 달 입력 ${k(u.inputTokens)} / 출력 ${k(u.outputTokens)} 토큰 · 예상 ${u.cost.toFixed(2)} ${u.currency}`
                        : "이번 달 사용량 없음";
                    })()}
                  </div>
                  <div className="muted">
                    {l.ai_levels && l.ai_levels.length > 0
                      ? `AI 레벨: ${l.ai_levels.map((a) => `Lv.${a.level} ${a.name}${a.is_active ? "" : "(비활성)"}`).join(", ")}`
                      : "사용하는 AI 레벨 없음"}
                  </div>
                </td>
                <td className="muted">{l.api_key ?? "-"}</td>
                <td>
                  <button className={`small${l.is_active ? "" : " danger"}`} onClick={() => toggle(l)}>
                    {l.is_active ? "ON" : "OFF"}
                  </button>
                </td>
                <td>
                  <button className="small" onClick={() => startEditCost(l)}>단가</button>{" "}
                  <button className="small" onClick={() => toggleAccounts(l)}>
                    계정 {l.account_count}
                  </button>{" "}
                  <button className="small danger" onClick={() => remove(l)}>삭제</button>
                </td>
              </tr>
              {editCostId === l.id && (
                <tr>
                  <td colSpan={6}>
                    <div className="panel">
                      <div className="row">
                        <div>
                          <label>입력 1M토큰당 비용</label>
                          <input type="number" min={0} step="any" value={costForm.cost_per_1m_input}
                            onChange={(e) => setCostForm({ ...costForm, cost_per_1m_input: Number(e.target.value) })} />
                        </div>
                        <div>
                          <label>출력 1M토큰당 비용</label>
                          <input type="number" min={0} step="any" value={costForm.cost_per_1m_output}
                            onChange={(e) => setCostForm({ ...costForm, cost_per_1m_output: Number(e.target.value) })} />
                        </div>
                        <div>
                          <label>통화</label>
                          <input type="text" value={costForm.cost_currency} placeholder="USD"
                            onChange={(e) => setCostForm({ ...costForm, cost_currency: e.target.value })} />
                        </div>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <button onClick={() => saveCost(l)}>저장</button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {openId === l.id && (
                <tr>
                  <td colSpan={6}>
                    <div className="panel">
                      <p className="muted">
                        계정이 없으면 LLM 자체의 API Key를 사용합니다. 모든 계정이 월 한도를 초과하면 이 LLM은 라우팅에서 제외됩니다.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>라벨</th>
                            <th>API Key</th>
                            <th>월 한도</th>
                            <th>이번 달 사용</th>
                            <th>상태</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map((a) => (
                            <tr key={a.id}>
                              <td>{a.label}</td>
                              <td className="muted">{a.api_key ?? "-"}</td>
                              <td>
                                {a.monthly_token_limit > 0
                                  ? a.monthly_token_limit.toLocaleString("en-US")
                                  : "0 (무제한)"}
                              </td>
                              <td>{(a.input_tokens + a.output_tokens).toLocaleString("en-US")}</td>
                              <td>
                                <button className={`small${a.is_active ? "" : " danger"}`} onClick={() => toggleAccount(a)}>
                                  {a.is_active ? "ON" : "OFF"}
                                </button>
                              </td>
                              <td>
                                <button className="small danger" onClick={() => removeAccount(a)}>삭제</button>
                              </td>
                            </tr>
                          ))}
                          {accounts.length === 0 && (
                            <tr>
                              <td colSpan={6} className="muted">등록된 계정이 없습니다.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div className="row" style={{ marginTop: 12 }}>
                        <div>
                          <label>라벨</label>
                          <input type="text" value={accForm.label}
                            onChange={(e) => setAccForm({ ...accForm, label: e.target.value })} />
                        </div>
                        <div>
                          <label>API Key</label>
                          <input type="password" value={accForm.api_key}
                            onChange={(e) => setAccForm({ ...accForm, api_key: e.target.value })} />
                        </div>
                        <div>
                          <label>월 토큰 한도 (0=무제한)</label>
                          <input type="number" min={0} value={accForm.monthly_token_limit}
                            onChange={(e) => setAccForm({ ...accForm, monthly_token_limit: Number(e.target.value) })} />
                        </div>
                      </div>
                      {accError && <p style={{ color: "var(--danger)", marginTop: 8 }}>{accError}</p>}
                      <div style={{ marginTop: 12 }}>
                        <button onClick={addAccount}>계정 추가</button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
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

interface ImgProv {
  id: number;
  name: string;
  provider: "openai" | "gemini" | "openai_compatible";
  model: string;
  api_key: string | null; // 마스킹됨
  base_url: string | null;
  size: string;
  cost_per_image: number;
  cost_currency: string;
  is_default: number;
  is_active: number;
}

const DEFAULT_MODEL: Record<string, string> = {
  openai: "gpt-image-1",
  gemini: "gemini-2.5-flash-image",
  openai_compatible: "",
};

const EMPTY_IMG = {
  name: "",
  provider: "openai" as ImgProv["provider"],
  model: "gpt-image-1",
  api_key: "",
  base_url: "",
  size: "1024x1536",
  cost_per_image: 0,
  cost_currency: "USD",
};

function ImageProviderTab() {
  const [list, setList] = useState<ImgProv[]>([]);
  const [form, setForm] = useState(EMPTY_IMG);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const r = await fetch("/api/image-providers");
    setList(r.ok ? await r.json() : []);
  };
  useEffect(() => {
    load();
  }, []);

  const put = async (id: number, body: Record<string, unknown>) => {
    const r = await fetch(`/api/image-providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "__KEEP__", ...body }),
    });
    if (!r.ok) setError((await r.json()).error ?? "저장 실패");
    load();
    return r.ok;
  };

  const submit = async () => {
    setError("");
    if (editId != null) {
      // 키를 비워두면 기존 키 유지
      const ok = await put(editId, { ...form, api_key: form.api_key || "__KEEP__" });
      if (ok) {
        setEditId(null);
        setForm(EMPTY_IMG);
      }
      return;
    }
    const r = await fetch("/api/image-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      setError((await r.json()).error ?? "생성 실패");
      return;
    }
    setForm(EMPTY_IMG);
    load();
  };

  const startEdit = (p: ImgProv) => {
    setEditId(p.id);
    setError("");
    setForm({
      name: p.name,
      provider: p.provider,
      model: p.model,
      api_key: "",
      base_url: p.base_url ?? "",
      size: p.size,
      cost_per_image: Number(p.cost_per_image),
      cost_currency: p.cost_currency,
    });
  };

  const remove = async (p: ImgProv) => {
    if (!confirm(`"${p.name}" 을(를) 삭제할까요?`)) return;
    await fetch(`/api/image-providers/${p.id}`, { method: "DELETE" });
    if (editId === p.id) {
      setEditId(null);
      setForm(EMPTY_IMG);
    }
    load();
  };

  return (
    <>
      <p className="muted">기본 프로바이더 1개가 이미지 생성에 사용됩니다.</p>
      <h3>{editId != null ? "이미지 생성 AI 수정" : "이미지 생성 AI 추가"}</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>이름</label>
            <input type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>종류</label>
            <select value={form.provider}
              onChange={(e) => {
                const provider = e.target.value as ImgProv["provider"];
                setForm({ ...form, provider, model: DEFAULT_MODEL[provider] ?? form.model });
              }}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="openai_compatible">OpenAI 호환</option>
            </select>
          </div>
          <div>
            <label>모델</label>
            <input type="text" value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>API Key</label>
            <input type="password" value={form.api_key}
              placeholder={editId != null ? "비우면 기존 키 유지" : ""}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </div>
          {form.provider === "openai_compatible" && (
            <div>
              <label>Base URL</label>
              <input type="text" value={form.base_url} placeholder="https://example.com/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </div>
          )}
          <div>
            <label>크기</label>
            <input type="text" value={form.size} placeholder="1024x1536"
              onChange={(e) => setForm({ ...form, size: e.target.value })} />
            <p className="muted">OpenAI 계열은 가로x세로(예: 1024x1536), Gemini 는 비율로 자동 변환됩니다.</p>
          </div>
        </div>
        <div className="row">
          <div>
            <label>장당 비용</label>
            <input type="number" min={0} step="any" value={form.cost_per_image}
              onChange={(e) => setForm({ ...form, cost_per_image: Number(e.target.value) })} />
          </div>
          <div>
            <label>통화</label>
            <input type="text" value={form.cost_currency} placeholder="USD"
              onChange={(e) => setForm({ ...form, cost_currency: e.target.value })} />
          </div>
        </div>
        {error && <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button onClick={submit}>{editId != null ? "저장" : "추가"}</button>{" "}
          {editId != null && (
            <button className="small" onClick={() => { setEditId(null); setForm(EMPTY_IMG); setError(""); }}>
              취소
            </button>
          )}
        </div>
      </div>

      <h3>등록된 이미지 생성 AI</h3>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>기본</th><th>이름</th><th>종류</th><th>모델</th><th>API Key</th><th>크기</th><th>장당 비용</th><th>상태</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.is_default ? (
                    <b>기본</b>
                  ) : (
                    <button className="small" onClick={() => put(p.id, { is_default: 1 })}>기본으로</button>
                  )}
                </td>
                <td>{p.name}</td>
                <td>{p.provider}</td>
                <td>
                  {p.model}
                  {p.base_url && <div className="muted">{p.base_url}</div>}
                </td>
                <td className="muted">{p.api_key ?? "-"}</td>
                <td>{p.size}</td>
                <td>{Number(p.cost_per_image)} {p.cost_currency}</td>
                <td>
                  <button className={`small${p.is_active ? "" : " danger"}`}
                    onClick={() => put(p.id, { is_active: p.is_active ? 0 : 1 })}>
                    {p.is_active ? "ON" : "OFF"}
                  </button>
                </td>
                <td>
                  <button className="small" onClick={() => startEdit(p)}>수정</button>{" "}
                  <button className="small danger" onClick={() => remove(p)}>삭제</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">등록된 이미지 생성 AI 가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
