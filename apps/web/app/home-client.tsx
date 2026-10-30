"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "./components/SiteHeader";
import { useCallback, useEffect, useRef, useState } from "react";

interface WorldItem {
  id: number;
  name: string;
  title_image_url: string | null;
  title_color: string | null;
  /** 제작 유저 닉네임 (운영 제작이면 null — 표시하지 않음) */
  owner_name: string | null;
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
}

/** 세계관 타이틀 컬러를 어두운 배경 톤으로 블렌딩 (#rrggbb → rgb) */
function tintBackground(hex: string | null | undefined): string | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const base = { r: 0x12, g: 0x14, b: 0x1a }; // --bg
  const mix = (c: number, bc: number) => Math.round(bc * 0.82 + c * 0.18);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${mix(r, base.r)}, ${mix(g, base.g)}, ${mix(b, base.b)})`;
}

type Sort = "popular" | "chats" | "newest" | "likes";
const LIMIT = 20;

interface LikeProps {
  liked: boolean;
  count: number;
  onToggle: () => void;
}

function CharCard({ c, like }: { c: CharItem; like: LikeProps }) {
  const img = c.title_image_url || c.thumb;
  // 세계관 타이틀 컬러를 CSS 변수로 — 호버 링/테두리가 같은 색을 쓰되 호버 반응은 유지
  const colorVar =
    c.title_color && /^#[0-9a-fA-F]{6}$/.test(c.title_color)
      ? ({ "--world-color": c.title_color } as React.CSSProperties)
      : undefined;
  return (
    <Link href={`/chat/${c.id}`} className="char-card" style={colorVar} title={`${c.name} — ${c.world_name}`}>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={c.name} className="title-img" />
      ) : (
        <div className="title-img placeholder" />
      )}
      <div className="char-card-name">{c.name}</div>
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
  // 내가 좋아요한 캐릭터 id 와 낙관적 갱신된 좋아요 수 (목록 캐시는 유저 무관하므로 분리 관리)
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  const router = useRouter();

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
  const likeProps = (c: CharItem): LikeProps => ({
    liked: likedIds.has(c.id),
    count: likeCounts[c.id] ?? c.like_count ?? 0,
    onToggle: () => toggleLike(c),
  });

  // 세계관 선택 시 배경을 타이틀 컬러 톤으로
  useEffect(() => {
    const w = worlds.find((x) => x.id === worldId);
    const tint = tintBackground(w?.title_color);
    document.body.style.backgroundColor = tint ?? "";
    return () => {
      document.body.style.backgroundColor = "";
    };
  }, [worldId, worlds]);

  // 필터/정렬 변경 시 이전 요청 결과를 무시하기 위한 세대 번호
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  // 최초 마운트: 세계관 목록 + 로그인 상태 확인
  useEffect(() => {
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds).catch(() => {});
    // 헤더(SiteHeader)도 /api/me 를 호출하므로 여기서는 준비 완료 신호만 사용
    fetch("/api/me")
      .catch(() => {})
      .finally(() => setMeReady(true));
    fetch("/api/characters/liked")
      .then((r) => r.json())
      .then((d) => setLikedIds(new Set(Array.isArray(d) ? d : [])))
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
    <SiteHeader />
    <div className="container">
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
            <span>{w.name}</span>
            {w.owner_name && <span className="world-card-owner">by {w.owner_name}</span>}
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
