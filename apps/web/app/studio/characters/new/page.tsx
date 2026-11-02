"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit } from "../../studio-api";
import WorldPickerModal, { WorldMini, type PickedWorld } from "../../components/WorldPickerModal";

export default function NewCharacterPage() {
  const router = useRouter();
  const [world, setWorld] = useState<PickedWorld | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // 이름 중복 확인 결과: null = 미확인/확인 중
  const [available, setAvailable] = useState<boolean | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // 인명사전 한정 공유 세계관: 아직 캐릭터가 연결되지 않은 인물 목록 (만들 수 있는 이름)
  const [freePersons, setFreePersons] = useState<{ id: number; title: string }[] | null>(null);
  const [personQ, setPersonQ] = useState("");

  useEffect(() => {
    setFreePersons(null);
    setPersonQ("");
    if (!world || world.mine || world.open_scope !== "dict_person") return;
    let alive = true;
    studioFetch(`/api/studio/open-worlds/${world.id}/persons`)
      .then((r) => r.json())
      .then((l) => alive && setFreePersons(Array.isArray(l) ? l : []))
      .catch(() => {});
    return () => { alive = false; };
  }, [world]);

  // 쿼리 프리필: 인명사전의 '캐릭터 만들기' 등에서 ?worldId=&name= 으로 진입
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const preName = sp.get("name");
    if (preName) setName(preName);
    const preWorldId = Number(sp.get("worldId"));
    if (!Number.isInteger(preWorldId) || preWorldId < 1) return;
    let alive = true;
    const toList = (r: Response) => r.json().then((l) => (Array.isArray(l) ? l : [])).catch(() => []);
    Promise.all([
      studioFetch("/api/studio/worlds").then(toList).catch(() => []),
      studioFetch("/api/studio/open-worlds").then(toList).catch(() => []),
    ]).then(([mine, open]) => {
      if (!alive) return;
      const m = mine.find((w: { id: number }) => w.id === preWorldId);
      const o = open.find((w: { id: number }) => w.id === preWorldId);
      const hit = m ?? o;
      if (hit) {
        setWorld({
          id: hit.id,
          name: hit.name,
          title_image_url: hit.title_image_url ?? null,
          title_color: hit.title_color ?? null,
          owner_nickname: hit.owner_nickname ?? null,
          open_scope: m ? "all" : hit.open_scope ?? "all",
          mine: !!m,
        });
      }
    });
    return () => { alive = false; };
  }, []);

  // 세계관 + 이름이 있으면 400ms 디바운스로 세계관 내 중복 확인
  useEffect(() => {
    setAvailable(null);
    setCreateError(null);
    const n = name.trim();
    if (!world || !n) return;
    let alive = true;
    const t = setTimeout(() => {
      studioFetch(`/api/studio/characters/check-name?worldId=${world.id}&name=${encodeURIComponent(n)}`)
        .then((r) => r.json())
        .then((d) => alive && setAvailable(d.available !== false))
        .catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [world, name]);

  const create = async () => {
    if (!world || !name.trim() || available === false || busy) return;
    setBusy(true);
    setCreateError(null);
    const res = await studioFetch("/api/studio/characters", jsonInit("POST", { world_id: world.id, name }));
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setCreateError(r.error ?? res.statusText);
      return;
    }
    router.replace(`/studio/characters/${r.id}`);
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" className="back-link" title="스튜디오로">‹</Link> 새 캐릭터
      </h2>
      <div className="panel">
        <label>세계관</label>
        {world ? (
          <div className="world-mini-row">
            <WorldMini world={world} />
            <button type="button" className="small ghost" onClick={() => setPickerOpen(true)}>변경</button>
          </div>
        ) : (
          <button type="button" className="ghost" onClick={() => setPickerOpen(true)}>세계관 선택하기</button>
        )}
        <WorldPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setWorld} />

        <label>캐릭터 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        {available === true && <div className="muted ok-text">✓ 사용 가능</div>}
        {available === false && <div className="muted err-text">✗ 이미 사용 중인 이름입니다</div>}
        {createError && <div className="muted err-text">{createError}</div>}
        <button onClick={create} disabled={busy || !world || !name.trim() || available === false}>{busy ? "생성 중..." : "만들기"}</button>

        {world && !world.mine && world.open_scope === "dict_person" && (
          <>
            <h3>인명사전</h3>
            <div className="notice">
              이 세계관은 인명사전에 있는 인물 이름으로만 만들 수 있습니다. 아래에서 아직 캐릭터가 없는 인물을
              골라 시작하세요.
            </div>
            {freePersons && freePersons.length > 0 && (
              <div
                className="dict-person-box"
                style={
                  // 월드픽커 카드와 동일하게 세계관 타이틀 컬러를 CSS 변수로 — 칩 호버/선택 색에 쓴다
                  world.title_color && /^#[0-9a-fA-F]{6}$/.test(world.title_color)
                    ? ({ "--world-color": world.title_color } as CSSProperties)
                    : undefined
                }
              >
                <input
                  value={personQ}
                  onChange={(e) => setPersonQ(e.target.value)}
                  placeholder="인물 이름 검색"
                />
                <div className="dict-person-list">
                  {freePersons
                    .filter((p) => !personQ.trim() || p.title.toLowerCase().includes(personQ.trim().toLowerCase()))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`dict-person-chip${name.trim() === p.title ? " sel" : ""}`}
                        onClick={() => setName(p.title)}
                      >
                        {p.title}
                      </button>
                    ))}
                  {personQ.trim() &&
                    !freePersons.some((p) => p.title.toLowerCase().includes(personQ.trim().toLowerCase())) && (
                      <div className="muted">검색 결과가 없습니다.</div>
                    )}
                </div>
              </div>
            )}
            {freePersons && freePersons.length === 0 && (
              <div className="muted" style={{ margin: "8px 0" }}>
                캐릭터로 만들 수 있는(아직 연결되지 않은) 인물이 없습니다.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
