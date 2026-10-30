"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SiteHeader from "../components/SiteHeader";
import { studioFetch, jsonInit } from "./studio-api";
import WorldPickerModal, { type PickedWorld } from "./components/WorldPickerModal";

interface WorldRow {
  id: number;
  name: string;
  visibility: "private" | "open";
  character_count: number;
  delete_scheduled_at?: string | null;
}
interface CharRow {
  id: number;
  name: string;
  world_name: string;
  visibility: "private" | "open";
  delete_scheduled_at?: string | null;
  /** 활성 제재(기간제 비공개) 정보 — 제작자 안내용 */
  sanction_until?: string | null;
  sanction_reason?: string | null;
}

/** 운영 제재 중 뱃지 (사유/기간은 툴팁) */
function SanctionBadge({ until, reason }: { until?: string | null; reason?: string | null }) {
  if (!until) return null;
  const dt = new Date(until).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <span
      className="badge"
      style={{ color: "#e0b050", borderColor: "#e0a030", marginLeft: 4 }}
      title={`운영 제재로 ${dt} 까지 비공개 (신규 대화 시작 불가)${reason ? ` · 사유: ${reason}` : ""}`}
    >
      제재 중 ~{dt}
    </span>
  );
}

function DelBadge({ at }: { at?: string | null }) {
  if (!at) return null;
  return (
    <span className="badge" style={{ color: "#e5484d", borderColor: "#e5484d", marginLeft: 4 }}>
      삭제 대기
    </span>
  );
}

function VisBadge({ v, world }: { v: "private" | "open"; world?: boolean }) {
  const on = world ? "공유" : "공개";
  const off = world ? "비공유" : "비공개";
  return <span className={`badge ${v === "open" ? "open" : ""}`}>{v === "open" ? on : off}</span>;
}

export default function StudioPage() {
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  const [chars, setChars] = useState<CharRow[] | null>(null);

  // JSON 가져오기: 세계관은 바로, 캐릭터는 파일 선택 후 WorldPickerModal 로 대상 세계관 선택
  const worldFileRef = useRef<HTMLInputElement>(null);
  const charFileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingChar, setPendingChar] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);

  const readJson = async (e: React.ChangeEvent<HTMLInputElement>): Promise<unknown> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return null;
    try {
      return JSON.parse(await file.text());
    } catch {
      alert("올바른 JSON 파일이 아닙니다.");
      return null;
    }
  };
  /** 가져오기 POST 공통: 실패 알림, 경고 표시, 성공 시 편집 페이지로 이동 */
  const postImport = async (url: string, body: unknown, editBase: string) => {
    setImporting(true);
    try {
      const res = await studioFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(r.error ?? "가져오기 실패");
        return;
      }
      if (r.warnings?.length) alert(`가져오기 완료 (경고 ${r.warnings.length}건)\n` + r.warnings.slice(0, 20).join("\n"));
      window.location.href = `${editBase}/${r.id}`;
    } finally {
      setImporting(false);
    }
  };
  const onWorldFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const data = await readJson(e);
    if (data) await postImport("/api/studio/worlds/import", data, "/studio/worlds");
  };
  const onCharFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const data = await readJson(e);
    if (data) {
      setPendingChar(data);
      setPickerOpen(true);
    }
  };
  const onPickWorld = (w: PickedWorld) => {
    const data = pendingChar;
    setPendingChar(null);
    if (data) postImport("/api/studio/characters/import", { worldId: w.id, data }, "/studio/characters");
  };

  // AI 보조 설정 (내 Claude 키)
  const [aiKey, setAiKey] = useState<{ hasKey: boolean; masked: string | null; byokEnabled: boolean; byokCost: number } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const loadAiKey = () =>
    studioFetch("/api/studio/ai-key").then((r) => r.json()).then((d) => setAiKey(d.error ? null : d)).catch(() => {});
  const saveAiKey = async () => {
    setKeyBusy(true);
    try {
      const res = await studioFetch("/api/studio/ai-key", jsonInit("PUT", { apiKey: keyInput }));
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(r.error ?? "등록 실패");
        return;
      }
      setKeyInput("");
      await loadAiKey();
    } finally {
      setKeyBusy(false);
    }
  };
  const testAiKey = async (useInput: boolean) => {
    setKeyBusy(true);
    try {
      const res = await studioFetch("/api/studio/ai-key/test", jsonInit("POST", useInput ? { apiKey: keyInput } : {}));
      const r = await res.json().catch(() => ({}));
      if (r.ok) alert("키가 정상 작동합니다.");
      else alert(`키 테스트 실패: ${r.error ?? "알 수 없는 오류"}`);
    } finally {
      setKeyBusy(false);
    }
  };
  const deleteAiKey = async () => {
    if (!confirm("등록된 Claude API 키를 등록해제할까요?")) return;
    setKeyBusy(true);
    try {
      const res = await studioFetch("/api/studio/ai-key", { method: "DELETE" });
      if (!res.ok) {
        const r = await res.json().catch(() => ({}));
        alert(r.error ?? "삭제 실패");
        return;
      }
      await loadAiKey();
    } finally {
      setKeyBusy(false);
    }
  };

  useEffect(() => {
    loadAiKey();
    studioFetch("/api/studio/worlds").then((r) => r.json()).then(setWorlds).catch(() => setWorlds([]));
    studioFetch("/api/studio/characters").then((r) => r.json()).then(setChars).catch(() => setChars([]));
  }, []);

  return (
    <>
    <SiteHeader />
    <div className="container studio">
      <div className="studio-top">
        <h2 className="page-title">
          <Link href="/" className="back-link" title="홈으로">‹</Link> 스튜디오
        </h2>
      </div>
      <p className="page-sub">나만의 세계관과 캐릭터를 만들고 공개해 보세요.</p>

      <div className="studio-top">
        <h3>내 세계관</h3>
        <div>
          <input ref={worldFileRef} type="file" accept="application/json,.json" hidden onChange={onWorldFile} />
          <button className="small ghost" disabled={importing} onClick={() => worldFileRef.current?.click()}>가져오기</button>{" "}
          <Link href="/studio/worlds/new"><button className="small">+ 새 세계관</button></Link>
        </div>
      </div>
      <div className="panel">
        {worlds === null && <p className="muted">불러오는 중...</p>}
        {worlds?.length === 0 && <p className="muted">아직 만든 세계관이 없습니다.</p>}
        {worlds?.map((w) => (
          <div key={w.id} className="list-item">
            <div>
              {w.name} <VisBadge v={w.visibility} world /><DelBadge at={w.delete_scheduled_at} />
              <div className="muted">캐릭터 {w.character_count}명</div>
            </div>
            <div>
              <a href={`/api/studio/worlds/${w.id}/export`} download style={{ color: "var(--muted)", marginRight: 10 }}>내보내기</a>
              <Link href={`/studio/worlds/${w.id}`} style={{ color: "var(--accent)" }}>편집</Link>
            </div>
          </div>
        ))}
      </div>

      <div className="studio-top">
        <h3>내 캐릭터</h3>
        <div>
          <input ref={charFileRef} type="file" accept="application/json,.json" hidden onChange={onCharFile} />
          <button className="small ghost" disabled={importing} onClick={() => charFileRef.current?.click()}>가져오기</button>{" "}
          <Link href="/studio/characters/new"><button className="small">+ 새 캐릭터</button></Link>
        </div>
      </div>
      <div className="panel">
        {chars === null && <p className="muted">불러오는 중...</p>}
        {chars?.length === 0 && <p className="muted">아직 만든 캐릭터가 없습니다.</p>}
        {chars?.map((c) => (
          <div key={c.id} className="list-item">
            <div>
              {c.name} <VisBadge v={c.visibility} /><DelBadge at={c.delete_scheduled_at} />
              <SanctionBadge until={c.sanction_until} reason={c.sanction_reason} />
              <div className="muted">{c.world_name}</div>
            </div>
            <div>
              <a href={`/api/studio/characters/${c.id}/export`} download style={{ color: "var(--muted)", marginRight: 10 }}>내보내기</a>
              <Link href={`/studio/characters/${c.id}`} style={{ color: "var(--accent)" }}>편집</Link>
            </div>
          </div>
        ))}
      </div>

      {aiKey?.byokEnabled && (
        <>
          <div className="studio-top">
            <h3>AI 보조 설정</h3>
          </div>
          <div className="panel">
            <p className="muted">
              내 Claude API 키를 등록하면 AI 생성이 내 키로 호출되고, 코인은 회당 {aiKey.byokCost.toLocaleString()}코인 정액만 차감됩니다.
            </p>
            {aiKey.hasKey ? (
              <div className="list-item">
                <div>
                  내 Claude API 키 <span className="muted">{aiKey.masked}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="small ghost" disabled={keyBusy} onClick={() => testAiKey(false)}>키 테스트</button>
                  <button className="small ghost" disabled={keyBusy} onClick={deleteAiKey}>등록해제</button>
                </div>
              </div>
            ) : (
              <div className="list-item">
                <input
                  type="password"
                  value={keyInput}
                  placeholder="sk-ant-..."
                  autoComplete="new-password"
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <button className="small ghost" disabled={keyBusy || !keyInput.trim()} onClick={() => testAiKey(true)}>키 테스트</button>
                <button className="small" disabled={keyBusy || !keyInput.trim()} onClick={saveAiKey}>등록</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
    <WorldPickerModal open={pickerOpen} onClose={() => { setPickerOpen(false); setPendingChar(null); }} onSelect={onPickWorld} />
    </>
  );
}
