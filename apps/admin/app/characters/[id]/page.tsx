"use client";

import { useEffect, useState, use } from "react";

interface Character {
  id: number;
  world_id: number;
  name: string;
  profile: string;
  personality: string;
  speech_style: string;
  ai_prompt: string;
  is_active: number;
}

interface WorldOption { id: number; name: string; }
interface CharOption { id: number; name: string; }

interface Relationship {
  id: number;
  target_character_id: number;
  target_name: string;
  relation: string;
}

interface Illust {
  id: number;
  kind: "basic" | "conditional";
  url: string;
  description: string | null;
  trigger_condition: { type: string; keywords: string[] } | string | null;
}

function triggerKeywords(i: Illust): string[] {
  if (!i.trigger_condition) return [];
  const t = typeof i.trigger_condition === "string"
    ? JSON.parse(i.trigger_condition)
    : i.trigger_condition;
  return t.keywords ?? [];
}

export default function CharacterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [char, setChar] = useState<Character | null>(null);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [others, setOthers] = useState<CharOption[]>([]);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [illusts, setIllusts] = useState<Illust[]>([]);
  const [saved, setSaved] = useState(false);

  const [newRel, setNewRel] = useState({ target: "" as number | "", relation: "" });
  const [upload, setUpload] = useState({
    kind: "basic" as "basic" | "conditional",
    description: "",
    keywords: "",
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  const loadRels = () =>
    fetch(`/api/characters/${id}/relationships`).then((r) => r.json()).then(setRels);
  const loadIllusts = () =>
    fetch(`/api/characters/${id}/illustrations`).then((r) => r.json()).then(setIllusts);

  useEffect(() => {
    fetch(`/api/characters/${id}`)
      .then((r) => r.json())
      .then((c: Character) => {
        setChar(c);
        fetch(`/api/characters?worldId=${c.world_id}`)
          .then((r) => r.json())
          .then((list: CharOption[]) => setOthers(list.filter((o) => o.id !== c.id)));
      });
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);
    loadRels();
    loadIllusts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!char) return <p>로딩 중...</p>;

  const save = async () => {
    await fetch(`/api/characters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(char),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const addRel = async () => {
    if (!newRel.target || !newRel.relation.trim()) return;
    await fetch(`/api/characters/${id}/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_character_id: newRel.target, relation: newRel.relation }),
    });
    setNewRel({ target: "", relation: "" });
    loadRels();
  };

  const removeRel = async (relId: number) => {
    await fetch(`/api/relationships/${relId}`, { method: "DELETE" });
    loadRels();
  };

  const doUpload = async () => {
    if (!upload.file) {
      alert("이미지 파일을 선택하세요.");
      return;
    }
    if (upload.kind === "conditional" && !upload.keywords.trim()) {
      alert("조건부 일러스트는 트리거 키워드가 필요합니다.");
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", upload.file);
    form.append("kind", upload.kind);
    form.append("description", upload.description);
    form.append("keywords", upload.keywords);
    const res = await fetch(`/api/characters/${id}/illustrations`, {
      method: "POST",
      body: form,
    });
    setUploading(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`업로드 실패: ${err.error ?? res.statusText}`);
      return;
    }
    setUpload({ kind: "basic", description: "", keywords: "", file: null });
    loadIllusts();
  };

  const removeIllust = async (illustId: number) => {
    if (!confirm("일러스트를 삭제할까요?")) return;
    await fetch(`/api/illustrations/${illustId}`, { method: "DELETE" });
    loadIllusts();
  };

  return (
    <>
      <h2>캐릭터 편집: {char.name}</h2>

      <div className="panel">
        <div className="row">
          <div>
            <label>이름</label>
            <input value={char.name} onChange={(e) => setChar({ ...char, name: e.target.value })} />
          </div>
          <div>
            <label>세계관</label>
            <select
              value={char.world_id}
              onChange={(e) => setChar({ ...char, world_id: Number(e.target.value) })}
            >
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        </div>
        <label>캐릭터 설정</label>
        <textarea
          rows={5}
          value={char.profile}
          onChange={(e) => setChar({ ...char, profile: e.target.value })}
          placeholder="출신, 외모, 배경 스토리 등"
        />
        <label>기본 성격</label>
        <textarea
          rows={3}
          value={char.personality}
          onChange={(e) => setChar({ ...char, personality: e.target.value })}
        />
        <label>말투</label>
        <textarea
          rows={3}
          value={char.speech_style}
          onChange={(e) => setChar({ ...char, speech_style: e.target.value })}
          placeholder="예: 존댓말, 특정 어미 사용, 자주 쓰는 감탄사 등"
        />
        <label>캐릭터별 세세한 프롬프트</label>
        <textarea
          rows={6}
          value={char.ai_prompt}
          onChange={(e) => setChar({ ...char, ai_prompt: e.target.value })}
          placeholder="이 캐릭터에게만 적용되는 상세 AI 지침"
        />
        <label>
          <input
            type="checkbox"
            checked={!!char.is_active}
            onChange={(e) => setChar({ ...char, is_active: e.target.checked ? 1 : 0 })}
            style={{ width: "auto", marginRight: 6 }}
          />
          활성화 (유저 화면에 노출)
        </label>
        <button onClick={save}>{saved ? "저장됨 ✓" : "저장"}</button>
      </div>

      <h3>다른 캐릭터와의 관계</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>대상 캐릭터 (같은 세계관)</label>
            <select
              value={newRel.target}
              onChange={(e) => setNewRel({ ...newRel, target: Number(e.target.value) || "" })}
            >
              <option value="">선택...</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>관계 설명</label>
            <input
              value={newRel.relation}
              onChange={(e) => setNewRel({ ...newRel, relation: e.target.value })}
              placeholder="예: 소꿉친구이자 라이벌. 겉으론 티격태격하지만 신뢰가 깊다."
            />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button style={{ marginTop: 0 }} onClick={addRel}>추가</button>
          </div>
        </div>
        <table style={{ marginTop: 14 }}>
          <tbody>
            {rels.map((r) => (
              <tr key={r.id}>
                <td style={{ width: 140 }}><b>{r.target_name}</b></td>
                <td>{r.relation}</td>
                <td style={{ width: 70 }}>
                  <button className="danger small" onClick={() => removeRel(r.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {rels.length === 0 && (
              <tr><td className="muted">등록된 관계가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h3>일러스트</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>종류</label>
            <select
              value={upload.kind}
              onChange={(e) =>
                setUpload({ ...upload, kind: e.target.value as "basic" | "conditional" })
              }
            >
              <option value="basic">기본 (자주 노출)</option>
              <option value="conditional">조건부 (특정 조건에서만)</option>
            </select>
          </div>
          <div>
            <label>설명</label>
            <input
              value={upload.description}
              onChange={(e) => setUpload({ ...upload, description: e.target.value })}
            />
          </div>
        </div>
        {upload.kind === "conditional" && (
          <>
            <label>트리거 키워드 (쉼표 구분 — 응답에 이 단어가 포함되면 노출)</label>
            <input
              value={upload.keywords}
              onChange={(e) => setUpload({ ...upload, keywords: e.target.value })}
              placeholder="예: 화남, 분노, 짜증"
            />
          </>
        )}
        <label>이미지 파일</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })}
        />
        <button onClick={doUpload} disabled={uploading}>
          {uploading ? "업로드 중..." : "업로드"}
        </button>
        <p className="muted" style={{ marginTop: 8 }}>
          업로드 대상(S3/FTP)은 설정 메뉴에서 지정합니다.
        </p>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>미리보기</th><th>종류</th><th>설명</th><th>트리거 키워드</th><th></th></tr>
          </thead>
          <tbody>
            {illusts.map((i) => (
              <tr key={i.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><img src={i.url} alt={i.description ?? ""} className="thumb" /></td>
                <td>
                  <span className={`badge ${i.kind === "conditional" ? "cond" : ""}`}>
                    {i.kind === "conditional" ? "조건부" : "기본"}
                  </span>
                </td>
                <td>{i.description}</td>
                <td className="muted">{triggerKeywords(i).join(", ")}</td>
                <td><button className="danger small" onClick={() => removeIllust(i.id)}>삭제</button></td>
              </tr>
            ))}
            {illusts.length === 0 && (
              <tr><td colSpan={5} className="muted">등록된 일러스트가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
