"use client";

import { useEffect, useState } from "react";

type Track = "user" | "creator";
type Cond = Record<string, number>;

interface Tier {
  id: number;
  name: string;
  /** 이모지 또는 이미지 URL — 상단바 등급 표시용 */
  icon: string | null;
  description: string | null;
  is_default: number;
  chat_cost: number;
  discount_rate: number;
  track: Track;
  tier_rank: number;
  fee_bonus: number;
  is_override?: number | boolean;
  conditions: Cond | string | null;
}

// core 는 "use client" 페이지에서 import 불가 — 라벨 하드코딩
const COND_LABELS: [string, string][] = [
  ["messages", "보낸 메시지 수"],
  ["tokensUsed", "사용 토큰"],
  ["chatCharacters", "대화한 캐릭터 수"],
  ["chatWorlds", "대화한 월드 수"],
  ["affinityMax", "최고 호감도"],
  ["spentCoins", "사용한 코인"],
  ["createdWorlds", "생성한 월드 수"],
  ["createdCharacters", "생성한 캐릭터 수"],
  ["publicWorlds", "공개한 월드 수"],
  ["publicCharacters", "공개한 캐릭터 수"],
  ["feeEarned", "수수료 수익(코인)"],
  ["receivedChats", "내 캐릭터가 받은 대화 수"],
  ["sanctionCount", "제재 횟수(본인+내 캐릭터)"],
];

// 편집 상태: 체크된 조건만 키로 존재
interface Edit {
  name: string;
  icon: string;
  description: string;
  tier_rank: number;
  chat_cost: number;
  discount_rate: number;
  fee_bonus: number;
  is_override: boolean;
  conds: Cond;
}

const OverrideBadge = () => (
  <span className="badge" style={{ color: "#e5484d", borderColor: "#e5484d" }}>우선 적용</span>
);

function parseConds(raw: Tier["conditions"]): Cond {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  const out: Cond = {};
  if (obj && typeof obj === "object") {
    for (const [k] of COND_LABELS) {
      const v = Number((obj as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
  }
  return out;
}

function summarize(t: Tier): string {
  const conds = parseConds(t.conditions);
  const parts = COND_LABELS.filter(([k]) => k in conds).map(
    ([k, label]) => `${label} ${conds[k].toLocaleString("ko-KR")} 이상`
  );
  const head =
    t.track === "user"
      ? `할인 ${Number(t.discount_rate ?? 0)}%`
      : `수수료 가산 ${Number(t.fee_bonus ?? 0)}%p`;
  return parts.length ? `${head} · 조건: ${parts.join(", ")}` : `${head} · 자동 승급 없음`;
}

const SECTIONS: { track: Track; title: string }[] = [
  { track: "user", title: "유저 등급" },
  { track: "creator", title: "크리에이터 등급" },
];

export default function TiersPage() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [form, setForm] = useState({ track: "user" as Track, name: "", description: "", tier_rank: 0 });
  const [msg, setMsg] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggleOpen = (id: number) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  // 드롭: 같은 트랙 안에서 dragId 를 target 위치로 옮기고 tier_rank 재부여(맨 위 = n-1 … 맨 아래 = 0)
  const reorder = async (track: Track, from: number, to: number) => {
    if (from === to) return;
    const list = tiers
      .filter((t) => t.track === track)
      .sort((a, b) => b.tier_rank - a.tier_rank || b.id - a.id);
    const fi = list.findIndex((t) => t.id === from);
    const ti = list.findIndex((t) => t.id === to);
    if (fi < 0 || ti < 0) return;
    const next = [...list];
    const [moved] = next.splice(fi, 1);
    next.splice(ti, 0, moved);
    for (let i = 0; i < next.length; i++) {
      const rank = next.length - 1 - i;
      if (Number(next[i].tier_rank) === rank) continue;
      const r = await fetch(`/api/tiers/${next[i].id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier_rank: rank }),
      });
      if (!r.ok) {
        alert((await r.json()).error);
        break;
      }
    }
    await load();
  };

  const load = async () => {
    const t: Tier[] = await fetch("/api/tiers").then((r) => r.json());
    setTiers(t);
    setEdits(
      Object.fromEntries(
        t.map((x) => [
          x.id,
          {
            name: x.name,
            icon: x.icon ?? "",
            description: x.description ?? "",
            tier_rank: Number(x.tier_rank ?? 0),
            chat_cost: Number(x.chat_cost ?? 0),
            discount_rate: Number(x.discount_rate ?? 0),
            fee_bonus: Number(x.fee_bonus ?? 0),
            is_override: !!Number(x.is_override ?? 0),
            conds: parseConds(x.conditions),
          },
        ])
      )
    );
  };
  useEffect(() => {
    load();
  }, []);

  const patch = (id: number, p: Partial<Edit>) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));

  const toggleCond = (id: number, key: string, on: boolean) => {
    const conds = { ...edits[id].conds };
    if (on) conds[key] = conds[key] || 1;
    else delete conds[key];
    patch(id, { conds });
  };

  const create = async () => {
    if (!form.name.trim()) return;
    const r = await fetch("/api/tiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!r.ok) {
      alert((await r.json()).error);
      return;
    }
    setForm({ ...form, name: "", description: "", tier_rank: 0 });
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

  const save = async (t: Tier) => {
    const e = edits[t.id];
    if (!e.name.trim()) {
      alert("이름은 필수입니다.");
      return;
    }
    const body: Record<string, unknown> = {
      name: e.name,
      icon: e.icon,
      description: e.description,
      tier_rank: e.tier_rank,
      is_override: e.is_override,
      conditions: e.conds,
    };
    if (t.track === "user") {
      body.chat_cost = e.chat_cost;
      body.discount_rate = e.discount_rate;
    } else {
      body.fee_bonus = e.fee_bonus;
    }
    const r = await fetch(`/api/tiers/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = r.ok ? "저장됨 ✓" : (await r.json()).error;
    setMsg((m) => ({ ...m, [t.id]: text }));
    setTimeout(() => setMsg((m) => ({ ...m, [t.id]: "" })), 2000);
    if (r.ok) load();
  };

  return (
    <>
      <h2>등급</h2>
      <p className="muted">
        유저 등급(할인)과 크리에이터 등급(수수료 가산)은 조건 충족 시 자동 승급됩니다. 채팅에 쓸 LLM 은
        &apos;채팅 AI 레벨&apos; 메뉴에서 관리합니다.
      </p>

      <h3>등급 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>트랙</label>
            <select value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value as Track })}>
              <option value="user">유저 등급</option>
              <option value="creator">크리에이터 등급</option>
            </select>
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
            <label>순위(tier_rank)</label>
            <input type="number" min={0} step={1} value={form.tier_rank}
              onChange={(e) => setForm({ ...form, tier_rank: Number(e.target.value) })} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={create}>추가</button>
        </div>
      </div>

      {SECTIONS.map((sec) => {
        const list = tiers
          .filter((t) => t.track === sec.track)
          .sort((a, b) => b.tier_rank - a.tier_rank || b.id - a.id);
        return (
          <div key={sec.track}>
            <h3 style={{ marginTop: 24 }}>{sec.title}</h3>
            <p className="muted">드래그로 순위를 바꿀 수 있습니다. 위가 상위 등급입니다.</p>
            {list.length === 0 && <p className="muted">등급이 없습니다.</p>}
            {list.map((t) => {
              const e = edits[t.id];
              if (!e) return null;
              const isOpen = !!open[t.id];
              const condCount =Object.keys(e.conds).length;
              return (
                <div
                  className="panel"
                  key={t.id}
                  style={{
                    opacity: dragId === t.id ? 0.4 : 1,
                    outline: dragId !== null && overId === t.id && dragId !== t.id ? "2px dashed #3b82f6" : undefined,
                  }}
                  onDragOver={(ev) => {
                    const d = tiers.find((x) => x.id === dragId);
                    if (d && d.track === t.track) {
                      ev.preventDefault();
                      if (overId !== t.id) setOverId(t.id);
                    }
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    const d = tiers.find((x) => x.id === dragId);
                    setDragId(null);
                    setOverId(null);
                    if (d && d.track === t.track) reorder(t.track, d.id, t.id);
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      draggable
                      title="드래그하여 순위 변경"
                      style={{ cursor: "grab", userSelect: "none", fontSize: 18, padding: "0 4px" }}
                      onDragStart={(ev) => {
                        ev.dataTransfer.effectAllowed = "move";
                        ev.dataTransfer.setData("text/plain", String(t.id));
                        const panel = (ev.currentTarget as HTMLElement).closest(".panel");
                        if (panel) ev.dataTransfer.setDragImage(panel, 10, 10);
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                    >
                      ⠿
                    </span>
                    <h3 style={{ margin: 0, flex: 1, cursor: "pointer" }} onClick={() => toggleOpen(t.id)}>
                      {t.icon &&
                        (t.icon.startsWith("http") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.icon} alt="" style={{ width: 18, height: 18, objectFit: "contain", verticalAlign: -3, marginRight: 4 }} />
                        ) : (
                          <span style={{ marginRight: 4 }}>{t.icon}</span>
                        ))}
                      {t.name} <span className="badge">순위 {t.tier_rank}</span>{" "}
                      {t.track === "user" && t.is_default ? <span className="badge">기본 등급</span> : null}
                      {Number(t.is_override) ? <>{" "}<OverrideBadge /></> : null}
                    </h3>
                    <button className="small" onClick={() => toggleOpen(t.id)}>
                      {isOpen ? "접기 ▴" : "펼치기 ▾"}
                    </button>
                    {!(t.track === "user" && t.is_default) && (
                      <button className="small danger" onClick={() => remove(t)}>삭제</button>
                    )}
                  </div>
                  {!isOpen && (
                    <>
                      {t.description && <p className="muted" style={{ margin: "4px 0 0" }}>{t.description}</p>}
                      <p className="muted" style={{ margin: "4px 0 0" }}>
                        {Number(t.is_override) ? <><OverrideBadge />{" "}</> : null}
                        {summarize(t)}
                      </p>
                    </>
                  )}

                  {isOpen && (<>
                  <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                    <div style={{ flex: 2 }}>
                      <label>이름</label>
                      <input type="text" value={e.name} onChange={(ev) => patch(t.id, { name: ev.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>아이콘 (이모지/이미지 URL)</label>
                      <input type="text" value={e.icon} placeholder="🥇 또는 https://..."
                        onChange={(ev) => patch(t.id, { icon: ev.target.value })} />
                    </div>
                    <div style={{ flex: 3 }}>
                      <label>설명</label>
                      <input type="text" value={e.description}
                        onChange={(ev) => patch(t.id, { description: ev.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>순위</label>
                      <input type="number" min={0} step={1} value={e.tier_rank}
                        onChange={(ev) => patch(t.id, { tier_rank: Number(ev.target.value) })} />
                    </div>
                  </div>

                  <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                    {t.track === "user" ? (
                      <>
                        <div style={{ flex: 1 }}>
                          <label>할인율(%)</label>
                          <input type="number" min={0} max={100} step="any" value={e.discount_rate}
                            onChange={(ev) => patch(t.id, { discount_rate: Number(ev.target.value) })} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label>예비 채팅 1회 비용(코인)</label>
                          <input type="number" min={0} value={e.chat_cost}
                            onChange={(ev) => patch(t.id, { chat_cost: Number(ev.target.value) })}
                            title="평소 채팅 비용은 AI 레벨이 정합니다. 활성화된 AI 레벨이 하나도 없을 때만 이 값으로 과금됩니다." />
                        </div>
                      </>
                    ) : (
                      <div style={{ flex: 1 }}>
                        <label>수수료 가산(%p)</label>
                        <input type="number" min={0} step="any" value={e.fee_bonus}
                          onChange={(ev) => patch(t.id, { fee_bonus: Number(ev.target.value) })} />
                      </div>
                    )}
                    <div style={{ flex: 2 }} />
                  </div>

                  <h4 style={{ marginBottom: 6 }}>승급 조건 (체크한 조건을 모두 충족 시 자동 승급)</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                    {COND_LABELS.map(([key, label]) => {
                      const on = key in e.conds;
                      return (
                        <div key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input type="checkbox" checked={on} style={{ width: "auto" }}
                            onChange={(ev) => toggleCond(t.id, key, ev.target.checked)} />
                          <span style={{ flex: 1 }}>{label}</span>
                          <input type="number" min={1} disabled={!on} style={{ width: 110 }}
                            value={on ? e.conds[key] : ""}
                            onChange={(ev) =>
                              patch(t.id, { conds: { ...e.conds, [key]: Number(ev.target.value) } })
                            } />
                        </div>
                      );
                    })}
                  </div>
                  {condCount === 0 && <p className="muted">자동 승급 없음</p>}

                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                    <input type="checkbox" checked={e.is_override} style={{ width: "auto" }}
                      onChange={(ev) => patch(t.id, { is_override: ev.target.checked })} />
                    <span>우선 적용 — 조건 충족 시 다른 등급보다 우선 (조건 해제 시 사다리로 복귀)</span>
                  </label>

                  <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => save(t)}>저장</button>
                    {t.track === "user" && !t.is_default && (
                      <button className="small" onClick={() => makeDefault(t)}>기본 등급으로 지정</button>
                    )}
                    <span className="muted">{msg[t.id]}</span>
                  </div>
                  </>)}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
