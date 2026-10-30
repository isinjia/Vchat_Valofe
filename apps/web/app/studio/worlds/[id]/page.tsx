"use client";

import Link from "next/link";
import { useEffect, useState, use } from "react";
import AnniversarySection from "./AnniversarySection";
import DictionaryBrowser from "../../components/DictionaryBrowser";
import ImageCropModal from "../../components/ImageCropModal";
import ImageGenModal, { type ImageGenPayload } from "../../components/ImageGenModal";
import { useRouter } from "next/navigation";
import { studioFetch, jsonInit, aiCostLabel, type PricingInfo } from "../../studio-api";

interface World {
  id: number;
  name: string;
  description: string;
  ai_prompt: string;
  visibility: "private" | "open";
  title_image_url?: string | null;
  title_color?: string | null;
  delete_scheduled_at?: string | null;
}

interface DictEntry {
  id: number;
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
  has_embedding?: number;
  character_id?: number | null;
  character_name?: string | null;
  linked_character_id?: number | null;
}

interface CharOption {
  id: number;
  name: string;
  world_id: number;
}

const CATEGORY_LABEL = { location: "지역사전", person: "인명사전", term: "용어사전" } as const;

export default function StudioWorldEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dictKey, setDictKey] = useState(0); // 사전 목록 재조회 트리거
  const [newEntry, setNewEntry] = useState({
    category: "location" as DictEntry["category"],
    title: "",
    aliases: "",
    content: "",
  });
  const [characters, setCharacters] = useState<CharOption[]>([]);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("basic"); // 편집 탭
  const [titleCropOpen, setTitleCropOpen] = useState(false); // 타이틀 이미지 크롭 팝업
  const [genOpen, setGenOpen] = useState(false); // AI 타이틀 생성 모달
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  // 인물 항목 ↔ 내 캐릭터 연결 변경
  const linkCharacter = async (entryId: number, value: string) => {
    const res = await studioFetch(
      `/api/studio/worlds/${id}/dictionary/${entryId}`,
      jsonInit("PUT", { linked_character_id: value ? Number(value) : null })
    );
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`연결 실패: ${r.error ?? res.statusText}`);
    }
  };

  const loadDict = () => setDictKey((n) => n + 1);

  useEffect(() => {
    studioFetch(`/api/studio/worlds/${id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error ?? "불러오기 실패");
      else setWorld(d);
    });
    studioFetch("/api/studio/pricing").then((r) => r.json()).then((p) => setPricing(p)).catch(() => {});
    // 내 캐릭터 중 이 세계관 소속만 연결 캐릭터 옵션으로 사용
    studioFetch("/api/studio/characters")
      .then((r) => r.json())
      .then((list: CharOption[]) =>
        setCharacters(Array.isArray(list) ? list.filter((c) => c.world_id === Number(id)) : [])
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

  if (error) return <div className="container studio"><p className="empty">{error}</p></div>;
  if (!world) return <div className="container studio"><p className="muted-center">로딩 중...</p></div>;

  const costLabel = (kind: string) => aiCostLabel(pricing, kind);

  const save = async () => {
    const res = await studioFetch(`/api/studio/worlds/${id}`, jsonInit("PUT", world));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`저장 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  /** AI 생성 → textarea state 에 채움 (저장은 저장 버튼) */
  const generate = async (kind: "world_description" | "world_prompt", field: "description" | "ai_prompt") => {
    setGenerating(kind);
    try {
      const res = await studioFetch(
        "/api/studio/generate",
        jsonInit("POST", {
          kind,
          worldId: Number(id),
          // 저장 전 편집 중인 값을 컨텍스트에 반영
          fields: { name: world.name, description: world.description },
        })
      );
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`생성 실패: ${r.error ?? res.statusText}`);
        return;
      }
      setWorld((prev) => (prev ? { ...prev, [field]: r.text } : prev));
    } finally {
      setGenerating(null);
    }
  };

  /** 크롭 팝업 확인 → 타이틀 이미지 업로드 (실패 시 throw → 팝업 안에 에러 표시) */
  const uploadTitleImage = async (blob: Blob, filename: string) => {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await studioFetch(`/api/studio/worlds/${id}/title-image`, { method: "POST", body: form });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`업로드 실패: ${r.error ?? res.statusText}`);
    setWorld((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
  };

  /** 생성 모달 확인 → AI 타이틀 이미지 생성 (실패 시 throw → 모달 안에 에러 표시) */
  const generateTitleImage = async (p: ImageGenPayload) => {
    const res = await studioFetch(
      `/api/studio/worlds/${id}/title-image/generate`,
      jsonInit("POST", { prompt: p.prompt, refImages: p.refImages })
    );
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`생성 실패: ${r.error ?? res.statusText}`);
    setWorld((prev) => (prev ? { ...prev, title_image_url: r.url } : prev));
  };

  const addEntry = async () => {
    if (!newEntry.title.trim()) return;
    const res = await studioFetch(
      `/api/studio/worlds/${id}/dictionary`,
      jsonInit("POST", {
        ...newEntry,
        aliases: newEntry.aliases || null,
        character_id: null, // 이 화면은 공용 사전 전용 (캐릭터 전용은 캐릭터 편집에서 관리)
      })
    );
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`추가 실패: ${r.error ?? res.statusText}`);
      return;
    }
    if (r.warning) alert(r.warning);
    setNewEntry({ ...newEntry, title: "", aliases: "", content: "" });
    loadDict();
  };

  const removeEntry = async (entryId: number) => {
    await studioFetch(`/api/studio/worlds/${id}/dictionary/${entryId}`, { method: "DELETE" });
  };

  const removeWorld = async () => {
    const input = prompt("삭제하려면 세계관 이름을 똑같이 입력하세요: " + world.name);
    if (input === null) return;
    const res = await studioFetch(`/api/studio/worlds/${id}`, jsonInit("DELETE", { name: input }));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 실패: ${r.error ?? res.statusText}`);
      return;
    }
    alert("3일 후 삭제됩니다. 그 전까지 취소할 수 있습니다.");
    router.replace("/studio");
  };

  const cancelDelete = async () => {
    const res = await studioFetch(`/api/studio/worlds/${id}`, jsonInit("DELETE", { cancel: true }));
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(`삭제 취소 실패: ${r.error ?? res.statusText}`);
      return;
    }
    setReloadKey((n) => n + 1);
  };

  return (
    <div className="container studio">
      <h2 className="page-title">
        <Link href="/studio" className="back-link" title="스튜디오로">‹</Link> 세계관 편집: {world.name}
      </h2>

      {world.delete_scheduled_at && (
        <div className="notice" style={{ borderColor: "#e5484d", color: "#e5484d" }}>
          이 세계관은 {new Date(world.delete_scheduled_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 에 삭제됩니다.{" "}
          <button type="button" className="small" onClick={cancelDelete}>삭제 취소</button>
        </div>
      )}

      {/* 탭 바: 비활성 탭도 언마운트하지 않고 display:none 으로만 숨겨 입력값/fetch 상태 보존 */}
      <div className="tabs">
        <button type="button" className={`tab ${tab === "basic" ? "active" : ""}`} onClick={() => setTab("basic")}>기본</button>
        <button type="button" className={`tab ${tab === "dict" ? "active" : ""}`} onClick={() => setTab("dict")}>사전</button>
        <button type="button" className={`tab ${tab === "anniv" ? "active" : ""}`} onClick={() => setTab("anniv")}>기념일</button>
      </div>

      <div style={{ display: tab === "basic" ? undefined : "none" }}>
      <div className="panel">
        <label>타이틀 이미지 (세로 3:4)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
          {world.title_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={world.title_image_url} alt="타이틀 이미지" className="title-img" style={{ width: 120 }} />
          ) : (
            <div className="title-img placeholder" style={{ width: 120 }} />
          )}
          <div>
            <button type="button" className="small" onClick={() => setTitleCropOpen(true)}>이미지 업로드</button>{" "}
            <button type="button" className="small" onClick={() => setGenOpen(true)}>
              AI 생성{pricing?.illustGenCost != null ? ` (-${pricing.illustGenCost.toLocaleString()}코인)` : ""}
            </button>
          </div>
        </div>
        <ImageCropModal
          open={titleCropOpen}
          title="타이틀 이미지 업로드"
          aspect={3 / 4}
          onCancel={() => setTitleCropOpen(false)}
          onConfirm={uploadTitleImage}
        />
        <ImageGenModal
          open={genOpen}
          title="AI 타이틀 이미지 생성"
          initialPrompt={`세계관 타이틀 일러스트를 생성한다. 세로형 3:4.\n세계관: ${world.name}\n설정: ${(world.description ?? "").slice(0, 800)}`}
          submitSuffix={pricing?.illustGenCost != null ? ` (-${pricing.illustGenCost.toLocaleString()}코인)` : ""}
          onClose={() => setGenOpen(false)}
          onGenerate={generateTitleImage}
        />

        <label>타이틀 컬러</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input
            type="color"
            value={world.title_color ?? "#7c8cf8"}
            onChange={(e) => setWorld({ ...world, title_color: e.target.value })}
            style={{ width: 44, height: 32, padding: 2, cursor: "pointer" }}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {world.title_color ?? "미지정"} — 메인의 캐릭터 카드 테두리와 세계관 선택 시 배경 톤에 쓰입니다.
          </span>
          {world.title_color && (
            <button type="button" className="small ghost" onClick={() => setWorld({ ...world, title_color: null })}>
              지우기
            </button>
          )}
        </div>

        <label>이름</label>
        <input value={world.name} onChange={(e) => setWorld({ ...world, name: e.target.value })} />

        <label>
          기본 세계관 설정{" "}
          <button type="button" className="small" onClick={() => generate("world_description", "description")} disabled={generating !== null}>
            {generating === "world_description" ? "생성 중..." : `AI로 생성${costLabel("world_description")}`}
          </button>
        </label>
        <textarea
          rows={6}
          value={world.description}
          onChange={(e) => setWorld({ ...world, description: e.target.value })}
          placeholder="세계의 배경, 시대, 분위기, 규칙 등을 서술"
        />

        <label>
          AI 명령용 프롬프트 (세계관 공통){" "}
          <button type="button" className="small" onClick={() => generate("world_prompt", "ai_prompt")} disabled={generating !== null}>
            {generating === "world_prompt" ? "생성 중..." : `AI로 생성${costLabel("world_prompt")}`}
          </button>
        </label>
        <textarea
          rows={6}
          value={world.ai_prompt}
          onChange={(e) => setWorld({ ...world, ai_prompt: e.target.value })}
          placeholder="이 세계관의 모든 캐릭터에게 공통 적용되는 AI 지침"
        />

        <label>공개 여부</label>
        <select value={world.visibility} onChange={(e) => setWorld({ ...world, visibility: e.target.value as "private" | "open" })}>
          <option value="private">비공개 (나만 사용)</option>
          <option value="open">공개</option>
        </select>
        <div className="notice">
          세계관을 공개하면 다른 유저가 이 세계관으로 자신의 캐릭터를 만들 수 있습니다. 공개한 세계관의 캐릭터가
          대화에 쓰이면 세계관 제작자에게 수수료가 지급됩니다.
        </div>

        <button onClick={save}>{saved ? "저장됨 ✓" : "저장"}</button>
      </div>
      </div>

      <div style={{ display: tab === "dict" ? undefined : "none" }}>
      <h3>사전 항목 추가</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>분류</label>
            <select value={newEntry.category} onChange={(e) => setNewEntry({ ...newEntry, category: e.target.value as DictEntry["category"] })}>
              <option value="location">지역사전</option>
              <option value="person">인명사전</option>
              <option value="term">용어사전</option>
            </select>
          </div>
          <div>
            <label>표제어</label>
            <input value={newEntry.title} onChange={(e) => setNewEntry({ ...newEntry, title: e.target.value })} />
          </div>
          <div>
            <label>별칭 (쉼표 구분)</label>
            <input value={newEntry.aliases} onChange={(e) => setNewEntry({ ...newEntry, aliases: e.target.value })} />
          </div>
        </div>
        <label>내용</label>
        <textarea rows={3} value={newEntry.content} onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })} />
        <button onClick={addEntry}>항목 추가</button>
      </div>

      {(["location", "person", "term"] as const).map((cat) => (
        <DictionaryBrowser
          key={cat}
          baseUrl={`/api/studio/worlds/${id}/dictionary`}
          category={cat}
          title={CATEGORY_LABEL[cat]}
          refreshKey={dictKey}
          onDelete={removeEntry}
          linkChars={characters}
          onLink={linkCharacter}
        />
      ))}
      </div>

      <div style={{ display: tab === "anniv" ? undefined : "none" }}>
      <AnniversarySection worldId={id} />
      </div>

      {!world.delete_scheduled_at && <button className="danger" onClick={removeWorld}>세계관 삭제</button>}
    </div>
  );
}
