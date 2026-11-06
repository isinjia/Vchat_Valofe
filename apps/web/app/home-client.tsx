"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "./components/SiteHeader";
import { useCallback, useEffect, useRef, useState } from "react";
import { tintBackground } from "@/lib/tint";
import { PLAYER_PERSONALITY_TYPES } from "@vchatbot/core/src/player-persona";

interface WorldItem {
  id: number;
  name: string;
  title_image_url: string | null;
  title_color: string | null;
  like_count?: number;
  /** 제작 유저 닉네임 (운영 제작이면 null — 표시하지 않음) */
  owner_name: string | null;
  /** 19금 세계관 (성인 확인 유저에게만 내려오고 배지로 표시) */
  is_adult?: number;
}

interface CharItem {
  id: number;
  name: string;
  world_id: number;
  world_name: string;
  title_color?: string | null;
  title_image_url: string | null;
  thumb: string | null;
  like_count?: number;
  /** 제작 유저 닉네임 (운영 제작이면 null — 표시하지 않음) */
  owner_name?: string | null;
  /** 19금 (캐릭터 자체 또는 세계관 상속 — 성인 확인 유저에게만 내려옴) */
  is_adult?: number;
}


type Sort = "popular" | "chats" | "newest" | "likes" | "gifts";
const LIMIT = 20;

interface LikeProps {
  liked: boolean;
  count: number;
  onToggle: () => void;
}

/** 방송 화면이 따로 있는 캐릭터 → 카드도 그 화면으로 보낸다 (하루 에스티아 → /haru, 블랙 리리스 → /blacklilith) */
function chatHref(c: CharItem): string {
  if (c.name === "하루 에스티아" && c.world_name === "소울워커") return "/haru";
  if (c.name === "블랙 리리스" && c.world_name === "라스트오리진") return "/blacklilith";
  return `/chat/${c.id}`;
}

function CharCard({ c, like }: { c: CharItem; like: LikeProps }) {
  const img = c.title_image_url || c.thumb;
  // 세계관 타이틀 컬러를 CSS 변수로 — 호버 링/테두리가 같은 색을 쓰되 호버 반응은 유지
  const colorVar =
    c.title_color && /^#[0-9a-fA-F]{6}$/.test(c.title_color)
      ? ({ "--world-color": c.title_color } as React.CSSProperties)
      : undefined;
  return (
    <Link href={chatHref(c)} className="char-card" style={colorVar} title={`${c.name} — ${c.world_name}`}>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={c.name} className="title-img" />
      ) : (
        <div className="title-img placeholder" />
      )}
      <div className="char-card-name">
        {Number(c.is_adult) === 1 && <span className="adult-badge" title="19세 이상 전용">🔞</span>}
        {c.name}
      </div>
      <div className="char-card-world">
        {c.world_name}
        {c.owner_name && <span> · by {c.owner_name}</span>}
      </div>
      <div className="char-card-like">
        <button
          type="button"
          className={`like-btn${like.liked ? " liked" : ""}`}
          title={like.liked ? "좋아요 취소" : "좋아요"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            like.onToggle();
          }}
        >
          {like.liked ? "❤️" : "🤍"} {like.count.toLocaleString()}
        </button>
      </div>
    </Link>
  );
}

export default function HomeClient() {
  const [worlds, setWorlds] = useState<WorldItem[]>([]);
  const [worldId, setWorldId] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("popular");
  const [talked, setTalked] = useState<CharItem[]>([]);
  const [items, setItems] = useState<CharItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [meReady, setMeReady] = useState(false);
  // 플레이어 성격 타입 온보딩 — 로그인했는데 아직 미선택이면 선택 다이얼로그
  const [personaAsk, setPersonaAsk] = useState(false);
  const [personaSel, setPersonaSel] = useState<string | null>(null);
  const [personaSaving, setPersonaSaving] = useState(false);
  // 내가 좋아요한 캐릭터 id 와 낙관적 갱신된 좋아요 수 (목록 캐시는 유저 무관하므로 분리 관리)
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  // 세계관 좋아요 (같은 방식의 분리 관리)
  const [likedWorldIds, setLikedWorldIds] = useState<Set<number>>(new Set());
  const [worldLikeCounts, setWorldLikeCounts] = useState<Record<number, number>>({});
  const router = useRouter();

  const toggleWorldLike = async (w: WorldItem) => {
    try {
      const r = await fetch(`/api/worlds/${w.id}/like`, { method: "POST" });
      if (r.status === 401) {
        router.push("/login");
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setLikedWorldIds((prev) => {
        const next = new Set(prev);
        if (d.liked) next.add(w.id);
        else next.delete(w.id);
        return next;
      });
      setWorldLikeCounts((prev) => ({ ...prev, [w.id]: d.likeCount }));
    } catch {
      // 무시
    }
  };

  const toggleLike = async (c: CharItem) => {
    try {
      const r = await fetch(`/api/characters/${c.id}/like`, { method: "POST" });
      if (r.status === 401) {
        router.push("/login");
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (d.liked) next.add(c.id);
        else next.delete(c.id);
        return next;
      });
      setLikeCounts((prev) => ({ ...prev, [c.id]: d.likeCount }));
    } catch {
      // 무시
    }
  };
  /** 플레이어 성격 타입 저장 — 스토리 플레이에서 "나"의 말투를 고정하는 데 쓴다 */
  const savePersona = async () => {
    if (!personaSel || personaSaving) return;
    setPersonaSaving(true);
    try {
      const r = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalityType: personaSel }),
      });
      if (r.ok) setPersonaAsk(false);
    } finally {
      setPersonaSaving(false);
    }
  };

  const likeProps = (c: CharItem): LikeProps => ({
    liked: likedIds.has(c.id),
    count: likeCounts[c.id] ?? c.like_count ?? 0,
    onToggle: () => toggleLike(c),
  });

  // 세계관 선택 시 배경을 타이틀 컬러 톤으로 — 새 색이 위에서부터 쓸어내려오는 전환
  // settled: 정착된 배경, sweep: 내려오는 중인 새 배경 (애니메이션 끝나면 settled 로 승격)
  const [bgSettled, setBgSettled] = useState<string | null>(null);
  const [bgSweep, setBgSweep] = useState<{ color: string | null; seq: number } | null>(null);
  const bgTargetRef = useRef<string | null>(null);
  const bgSeqRef = useRef(0);

  useEffect(() => {
    const w = worlds.find((x) => x.id === worldId);
    const tint = tintBackground(w?.title_color);
    if (tint === bgTargetRef.current) return; // 목록 리프레시 등으로 색이 그대로면 재생 안 함
    bgTargetRef.current = tint;
    // 스윕 진행 중에 또 바뀌면 이전 스윕 색을 먼저 정착시키고 새 스윕 시작
    setBgSweep((prev) => {
      if (prev) setBgSettled(prev.color);
      return { color: tint, seq: ++bgSeqRef.current };
    });
  }, [worldId, worlds]);

  // 필터/정렬 변경 시 이전 요청 결과를 무시하기 위한 세대 번호
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  // 최초 마운트: 세계관 목록 + 로그인 상태 확인
  useEffect(() => {
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds).catch(() => {});
    // 헤더(SiteHeader)도 /api/me 를 호출하므로 여기서는 준비 신호 + 성격 타입 미선택 확인에 사용
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.personalityType === null) setPersonaAsk(true);
      })
      .catch(() => {})
      .finally(() => setMeReady(true));
    fetch("/api/characters/liked")
      .then((r) => r.json())
      .then((d) => setLikedIds(new Set(Array.isArray(d) ? d : [])))
      .catch(() => {});
    fetch("/api/worlds/liked")
      .then((r) => r.json())
      .then((d) => setLikedWorldIds(new Set(Array.isArray(d) ? d : [])))
      .catch(() => {});
  }, []);

  // 대화했던 캐릭터
  useEffect(() => {
    if (!meReady) return;
    const qs = worldId ? `?worldId=${worldId}` : "";
    fetch(`/api/characters/talked${qs}`)
      .then((r) => r.json())
      .then((d) => setTalked(Array.isArray(d) ? d : []))
      .catch(() => setTalked([]));
  }, [meReady, worldId]);

  const loadPage = useCallback(
    async (off: number) => {
      const g = gen.current;
      setLoading(true);
      try {
        const qs = new URLSearchParams({ sort, offset: String(off), limit: String(LIMIT) });
        if (worldId) qs.set("worldId", String(worldId));
        const res = await fetch(`/api/characters?${qs}`);
        const data = await res.json();
        if (g !== gen.current) return;
        setItems((prev) => (off === 0 ? data.items : [...prev, ...data.items]));
        setHasMore(!!data.hasMore);
        setOffset(off + LIMIT);
      } catch {
        if (g === gen.current) setHasMore(false);
      } finally {
        if (g === gen.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [sort, worldId]
  );

  // 필터/정렬 변경 → 초기화 후 재조회
  useEffect(() => {
    gen.current++;
    setItems([]);
    setHasMore(true);
    setLoaded(false);
    setOffset(0);
    loadPage(0);
  }, [loadPage]);

  // 무한 스크롤
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && loaded) loadPage(offset);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loaded, offset, loadPage]);

  return (
    <>
    {/* 세계관 틴트 배경 — 콘텐츠 뒤 고정 레이어, 전환 시 새 색이 위에서부터 내려온다 */}
    <div className="bg-tint-layer" style={{ background: bgSettled ?? "var(--bg)" }} />
    {bgSweep && (
      <div
        key={bgSweep.seq}
        className="bg-tint-layer sweep"
        style={{ "--sweep-color": bgSweep.color ?? "var(--bg)" } as React.CSSProperties}
        onAnimationEnd={() => {
          setBgSettled(bgSweep.color);
          setBgSweep(null);
        }}
      />
    )}
    <SiteHeader />

    {/* 첫 로그인(가입) 성격 타입 선택 — 스토리 플레이에서 플레이어 대사의 말투 기준이 된다 */}
    {personaAsk && (
      <div className="modal-backdrop">
        <div className="modal persona-modal">
          <h3>당신은 어떤 타입인가요?</h3>
          <p>
            선택한 성격 타입에 맞춰 스토리 플레이에서 &quot;나&quot;의 대사 말투가 유지됩니다.
            <br />
            캐릭터와 나눈 실제 대화 말투도 함께 반영돼요.
          </p>
          <div className="persona-grid">
            {PLAYER_PERSONALITY_TYPES.map((t) => (
              <button
                key={t.key}
                className={`persona-option ${personaSel === t.key ? "active" : ""}`}
                onClick={() => setPersonaSel(t.key)}
              >
                <strong>{t.label}</strong>
                <span>{t.desc}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="persona-later" onClick={() => setPersonaAsk(false)}>나중에 하기</button>
            <button className="persona-save" disabled={!personaSel || personaSaving} onClick={savePersona}>
              {personaSaving ? "저장 중..." : "이걸로 할게요"}
            </button>
          </div>
        </div>
      </div>
    )}

    <div className="container">
      <Link href="/haru" className="haru-live-banner" aria-label="하루 에스티아 방송 보러 가기">
        <span className="haru-live-badge">LIVE</span>
        <span className="haru-live-banner-text">
          <strong>하루 에스티아</strong> · 하루의 쉬는 시간 · 수다 방송
        </span>
        <span className="haru-live-banner-go">보러 가기 →</span>
      </Link>
      <Link href="/blacklilith" className="haru-live-banner" aria-label="블랙 리리스 방송 보러 가기">
        <span className="haru-live-badge">LIVE</span>
        <span className="haru-live-banner-text">
          <strong>블랙 리리스</strong> · 블랙 리리스의 경호 대기실 · 수다 방송
        </span>
        <span className="haru-live-banner-go">보러 가기 →</span>
      </Link>
      <h2 className="section-title">세계</h2>
      <div className="h-scroll">
        <button
          className={`world-card ${worldId === null ? "active" : ""}`}
          onClick={() => setWorldId(null)}
        >
          <div className="title-img placeholder world-all-tile">✦</div>
          <span>전체</span>
        </button>
        {worlds.map((w) => (
          <button
            key={w.id}
            className={`world-card ${worldId === w.id ? "active" : ""}`}
            style={
              w.title_color && /^#[0-9a-fA-F]{6}$/.test(w.title_color)
                ? ({ "--world-color": w.title_color } as React.CSSProperties)
                : undefined
            }
            title={`${w.name}${w.owner_name ? ` — by ${w.owner_name}` : ""}`}
            onClick={() => setWorldId(worldId === w.id ? null : w.id)}
          >
            {w.title_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.title_image_url} alt={w.name} className="title-img" />
            ) : (
              <div className="title-img placeholder" />
            )}
            <span>
              {Number(w.is_adult) === 1 && <span className="adult-badge" title="19세 이상 전용">🔞</span>}
              {w.name}
            </span>
            {w.owner_name && <span className="world-card-owner">by {w.owner_name}</span>}
            <span
              className={`world-like${likedWorldIds.has(w.id) ? " liked" : ""}`}
              role="button"
              tabIndex={0}
              title={likedWorldIds.has(w.id) ? "좋아요 취소" : "좋아요"}
              onClick={(e) => {
                e.stopPropagation();
                toggleWorldLike(w);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleWorldLike(w);
                }
              }}
            >
              {likedWorldIds.has(w.id) ? "❤️" : "🤍"} {(worldLikeCounts[w.id] ?? w.like_count ?? 0).toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {talked.length > 0 && (
        <>
          <h2 className="section-title">내가 대화했던 캐릭터</h2>
          <div className="h-scroll">
            {talked.map((c) => (
              <CharCard key={c.id} c={c} like={likeProps(c)} />
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2 className="section-title">전체 캐릭터</h2>
        <div className="sort-toggle">
          <button className={`sort-btn ${sort === "popular" ? "active" : ""}`} onClick={() => setSort("popular")}
            title="좋아요 많은 순 (동률이면 대화 수)">
            인기순
          </button>
          <button className={`sort-btn ${sort === "chats" ? "active" : ""}`} onClick={() => setSort("chats")}
            title="누적 대화가 많은 순">
            대화순
          </button>
          <button className={`sort-btn ${sort === "gifts" ? "active" : ""}`} onClick={() => setSort("gifts")}
            title="받은 선물이 많은 순 (선물 금액 기준)">
            받은 선물
          </button>
          <button className={`sort-btn ${sort === "newest" ? "active" : ""}`} onClick={() => setSort("newest")}>
            최신순
          </button>
        </div>
      </div>
      <div className="char-grid">
        {items.map((c) => (
          <CharCard key={c.id} c={c} like={likeProps(c)} />
        ))}
      </div>
      {loading && <p className="muted-center">불러오는 중...</p>}
      {loaded && !loading && items.length === 0 && <p className="empty">캐릭터가 없습니다</p>}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
    </>
  );
}
