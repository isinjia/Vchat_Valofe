"use client";

import { useEffect, useRef, useState } from "react";
import { studioFetch, jsonInit } from "../../studio-api";
import CoinIcon from "../../../components/CoinIcon";

/**
 * 세계관 선물 아이템 관리: 페이징 목록 + 필터(효과 종류 / 추가대상 캐릭터) +
 * 생성·수정(기본 효과, 캐릭터별 보너스, 사용 가능/불가 캐릭터, 가격/쿨다운/횟수) + 아이콘/큰 이미지 업로드
 */

interface CharOpt {
  id: number;
  name: string;
}

interface Bonus {
  character_id: number;
  bonus_affinity: number;
  character_name?: string;
}

interface Item {
  id: number;
  name: string;
  description: string | null;
  icon_url: string | null;
  image_url: string | null;
  price: number;
  affinity_delta: number;
  reset_affinity: number;
  cooldown_hours: number;
  max_uses_per_character: number;
  char_rule: { mode: "allow" | "deny"; ids: number[] } | string | null;
  is_active: number;
  sort_order: number;
  bonuses: Bonus[];
}

interface FormState {
  name: string;
  description: string;
  price: string;
  effect: "affinity" | "reset";
  affinityDelta: string;
  cooldownHours: string;
  maxUses: string;
  charMode: "all" | "allow" | "deny";
  charIds: number[];
  bonuses: { characterId: string; bonus: string }[];
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  price: "0",
  effect: "affinity",
  affinityDelta: "5",
  cooldownHours: "0",
  maxUses: "0",
  charMode: "all",
  charIds: [],
  bonuses: [],
  isActive: true,
};

function ruleOf(it: Item): { mode: "all" | "allow" | "deny"; ids: number[] } {
  if (!it.char_rule) return { mode: "all", ids: [] };
  try {
    const r = typeof it.char_rule === "string" ? JSON.parse(it.char_rule) : it.char_rule;
    if (r?.mode === "allow" || r?.mode === "deny") {
      return { mode: r.mode, ids: Array.isArray(r.ids) ? r.ids.map(Number) : [] };
    }
  } catch {
    // 무시
  }
  return { mode: "all", ids: [] };
}

function formOf(it: Item): FormState {
  const r = ruleOf(it);
  return {
    name: it.name,
    description: it.description ?? "",
    price: String(it.price),
    effect: it.reset_affinity ? "reset" : "affinity",
    affinityDelta: String(it.affinity_delta),
    cooldownHours: String(it.cooldown_hours),
    maxUses: String(it.max_uses_per_character),
    charMode: r.mode,
    charIds: r.ids,
    bonuses: it.bonuses.map((b) => ({ characterId: String(b.character_id), bonus: String(b.bonus_affinity) })),
    isActive: !!it.is_active,
  };
}

function payloadOf(f: FormState) {
  return {
    name: f.name,
    description: f.description,
    price: Number(f.price || 0),
    affinityDelta: f.effect === "reset" ? 0 : Number(f.affinityDelta || 0),
    resetAffinity: f.effect === "reset",
    cooldownHours: Number(f.cooldownHours || 0),
    maxUses: Number(f.maxUses || 0),
    charMode: f.charMode,
    charIds: f.charIds,
    bonuses: f.bonuses
      .filter((b) => b.characterId)
      .map((b) => ({ characterId: Number(b.characterId), bonus: Number(b.bonus || 0) })),
    isActive: f.isActive,
  };
}

export default function WorldItemsSection({ worldId }: { worldId: number | string }) {
  const base = `/api/studio/worlds/${worldId}/items`;
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [effectFilter, setEffectFilter] = useState("");
  const [charFilter, setCharFilter] = useState("");
  const [characters, setCharacters] = useState<CharOpt[]>([]);
  const [msg, setMsg] = useState("");
  // 생성/수정 폼
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErr, setFormErr] = useState("");
  // 이미지 업로드 대상
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ itemId: number; slot: "icon" | "image" } | null>(null);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (effectFilter) qs.set("effect", effectFilter);
    if (charFilter) qs.set("characterId", charFilter);
    const res = await studioFetch(`${base}?${qs}`);
    if (!res.ok) return;
    const d = await res.json();
    setItems(Array.isArray(d.items) ? d.items : []);
    setTotal(Number(d.total ?? 0));
    setCharacters(Array.isArray(d.characters) ? d.characters : []);
  };

  useEffect(() => {
    load(page).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, page, effectFilter, charFilter]);

  const pages = Math.max(1, Math.ceil(total / limit));

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormErr("");
    setFormOpen(true);
  };
  const openEdit = (it: Item) => {
    setEditId(it.id);
    setForm(formOf(it));
    setFormErr("");
    setFormOpen(true);
  };

  const submit = async () => {
    setFormErr("");
    const res = await studioFetch(editId == null ? base : `${base}/${editId}`, jsonInit(editId == null ? "POST" : "PUT", payloadOf(form)));
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormErr(r.error ?? "저장 실패");
      return;
    }
    setFormOpen(false);
    load();
  };

  const remove = async (it: Item) => {
    if (!confirm(`"${it.name}" 아이템을 삭제할까요? 사용 기록은 남지만 더 이상 사용할 수 없습니다.`)) return;
    await studioFetch(`${base}/${it.id}`, { method: "DELETE" });
    load();
  };

  const pickFile = (itemId: number, slot: "icon" | "image") => {
    uploadTarget.current = { itemId, slot };
    fileRef.current?.click();
  };
  const onFile = async (file: File | null) => {
    const t = uploadTarget.current;
    uploadTarget.current = null;
    if (!file || !t) return;
    setMsg("");
    const fd = new FormData();
    fd.append("slot", t.slot);
    fd.append("file", file);
    const res = await studioFetch(`${base}/${t.itemId}/image`, { method: "POST", body: fd });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      setMsg(`업로드 실패: ${r.error ?? res.statusText}`);
      return;
    }
    load();
  };

  const toggleCharId = (id: number) =>
    setForm((f) => ({
      ...f,
      charIds: f.charIds.includes(id) ? f.charIds.filter((x) => x !== id) : [...f.charIds, id],
    }));

  const charName = (id: number) => characters.find((c) => c.id === id)?.name ?? `#${id}`;

  const effectLabel = (it: Item) =>
    it.reset_affinity ? "호감도 0으로 초기화" : `호감도 ${it.affinity_delta > 0 ? "+" : ""}${it.affinity_delta}`;

  return (
    <>
      <h3>선물 아이템 ({total})</h3>
      <div className="panel">
        <div className="notice">
          유저가 채팅에서 코인으로 사용(선물)하면 호감도 효과가 적용됩니다. 판매액의 일부는 수수료율에 따라
          캐릭터 제작자에게 정산됩니다.
        </div>
        <div className="row">
          <div>
            <label>효과 종류</label>
            <select value={effectFilter} onChange={(e) => { setEffectFilter(e.target.value); setPage(1); }}>
              <option value="">전체</option>
              <option value="affinity">호감도 증감</option>
              <option value="reset">호감도 초기화</option>
            </select>
          </div>
          <div>
            <label>추가대상 캐릭터 (보너스 지정)</label>
            <select value={charFilter} onChange={(e) => { setCharFilter(e.target.value); setPage(1); }}>
              <option value="">전체</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button type="button" style={{ marginTop: 0 }} onClick={openCreate}>+ 아이템 추가</button>
          </div>
        </div>
        {msg && <p className="err-text" style={{ fontSize: 13 }}>{msg}</p>}

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr><th>아이콘</th><th>이름</th><th>가격</th><th>효과</th><th>제한</th><th>사용 캐릭터</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const r = ruleOf(it);
              return (
                <tr key={it.id}>
                  <td>
                    {it.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.icon_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 20 }}>🎁</span>
                    )}
                  </td>
                  <td>
                    <b>{it.name}</b>
                    {it.description && <div className="muted" style={{ fontSize: 12 }}>{it.description}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}><CoinIcon size={12} /> {Number(it.price).toLocaleString()}</td>
                  <td>
                    {effectLabel(it)}
                    {it.bonuses.length > 0 && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {it.bonuses.map((b) => `${b.character_name ?? charName(b.character_id)} +${b.bonus_affinity}`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {it.cooldown_hours > 0 ? `텀 ${it.cooldown_hours}시간` : "텀 없음"}
                    <br />
                    {it.max_uses_per_character > 0 ? `캐릭터당 ${it.max_uses_per_character}회` : "횟수 무제한"}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {r.mode === "all" && "전체 가능"}
                    {r.mode === "allow" && `가능: ${r.ids.map(charName).join(", ")}`}
                    {r.mode === "deny" && `불가: ${r.ids.map(charName).join(", ")}`}
                  </td>
                  <td>{it.is_active ? "ON" : <span className="muted">OFF</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="small" onClick={() => pickFile(it.id, "icon")}>아이콘</button>{" "}
                    <button className="small" onClick={() => pickFile(it.id, "image")}>큰 이미지</button>{" "}
                    <button className="small" onClick={() => openEdit(it)}>수정</button>{" "}
                    <button className="danger small" onClick={() => remove(it)}>삭제</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={8} className="muted">등록된 아이템이 없습니다.</td></tr>}
          </tbody>
        </table>

        {pages > 1 && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
            <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span className="muted" style={{ fontSize: 13 }}>{page} / {pages}</span>
            <button className="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>다음</button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      {formOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFormOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 640, maxHeight: "92vh", overflowY: "auto" }}>
            <h3>{editId == null ? "아이템 추가" : "아이템 수정"}</h3>
            <div className="row">
              <div>
                <label>이름</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 장미 꽃다발" />
              </div>
              <div>
                <label>가격 (코인)</label>
                <input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
            </div>
            <label>설명</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

            <div className="row">
              <div>
                <label>효과</label>
                <select value={form.effect} onChange={(e) => setForm({ ...form, effect: e.target.value as FormState["effect"] })}>
                  <option value="affinity">호감도 증감</option>
                  <option value="reset">호감도 0으로 초기화</option>
                </select>
              </div>
              {form.effect === "affinity" && (
                <div>
                  <label>기본 호감도 증감 (-100~100)</label>
                  <input type="number" min={-100} max={100} value={form.affinityDelta}
                    onChange={(e) => setForm({ ...form, affinityDelta: e.target.value })} />
                </div>
              )}
              <div>
                <label>최소 텀 (시간, 0=없음)</label>
                <input type="number" min={0} max={720} value={form.cooldownHours}
                  onChange={(e) => setForm({ ...form, cooldownHours: e.target.value })} />
              </div>
              <div>
                <label>캐릭터당 횟수 (0=무제한)</label>
                <input type="number" min={0} value={form.maxUses}
                  onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
              </div>
            </div>

            {form.effect === "affinity" && (
              <>
                <label>캐릭터별 추가 호감도 (기본 증감에 더해짐)</label>
                {form.bonuses.map((b, i) => (
                  <div key={i} className="row" style={{ alignItems: "flex-end" }}>
                    <div>
                      <select value={b.characterId}
                        onChange={(e) => setForm({ ...form, bonuses: form.bonuses.map((x, j) => (j === i ? { ...x, characterId: e.target.value } : x)) })}>
                        <option value="">캐릭터 선택...</option>
                        {characters.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <input type="number" min={-100} max={100} value={b.bonus} placeholder="추가 호감도"
                        onChange={(e) => setForm({ ...form, bonuses: form.bonuses.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)) })} />
                    </div>
                    <div style={{ flex: "0 0 auto" }}>
                      <button type="button" className="small btn-secondary" style={{ marginTop: 0 }}
                        onClick={() => setForm({ ...form, bonuses: form.bonuses.filter((_, j) => j !== i) })}>
                        제거
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" className="small btn-secondary"
                  onClick={() => setForm({ ...form, bonuses: [...form.bonuses, { characterId: "", bonus: "5" }] })}>
                  + 캐릭터 보너스 추가
                </button>
              </>
            )}

            <label style={{ marginTop: 12 }}>사용 가능/불가 캐릭터</label>
            <select value={form.charMode} onChange={(e) => setForm({ ...form, charMode: e.target.value as FormState["charMode"], charIds: [] })}>
              <option value="all">모든 캐릭터 사용 가능 (기본)</option>
              <option value="allow">지정한 캐릭터만 사용 가능</option>
              <option value="deny">지정한 캐릭터만 사용 불가</option>
            </select>
            {form.charMode !== "all" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                {characters.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="checkbox" style={{ width: "auto", margin: 0 }}
                      checked={form.charIds.includes(c.id)} onChange={() => toggleCharId(c.id)} />
                    {c.name}
                  </label>
                ))}
                {characters.length === 0 && <span className="muted">이 세계관에 캐릭터가 없습니다.</span>}
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              판매 활성 (끄면 유저에게 노출되지 않음)
            </label>

            {formErr && <p className="crop-err">{formErr}</p>}
            <div className="crop-actions">
              <span style={{ flex: 1 }} />
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>취소</button>
              <button type="button" onClick={submit}>{editId == null ? "추가" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
