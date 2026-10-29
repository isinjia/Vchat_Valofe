"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface WorldItem {
  id: number;
  name: string;
  title_image_url: string | null;
}

interface CharItem {
  id: number;
  name: string;
  world_id: number;
  world_name: string;
  title_image_url: string | null;
  thumb: string | null;
}

type Sort = "popular" | "newest";
const LIMIT = 20;

function CharCard({ c }: { c: CharItem }) {
  const img = c.title_image_url || c.thumb;
  return (
    <Link href={`/chat/${c.id}`} className="char-card">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={c.name} className="title-img" />
      ) : (
        <div className="title-img placeholder" />
      )}
      <div className="char-card-name">{c.name}</div>
      <div className="char-card-world">{c.world_name}</div>
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
  const [coins, setCoins] = useState<number | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);

  // 필터/정렬 변경 시 이전 요청 결과를 무시하기 위한 세대 번호
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  // 최초 마운트: 세계관 목록 + 로그인 상태 확인
  useEffect(() => {
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds).catch(() => {});
    fetch("/api/me")
      .then(async (r) => {
        if (r.status === 401) {
          setLoggedOut(true);
          return;
        }
        const me = await r.json();
        setCoins(typeof me.coins === "number" ? me.coins : null);
      })
      .catch(() => {})
      .finally(() => setMeReady(true));
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
    <div className="container">
      {coins !== null && (
        <div style={{ textAlign: "right", fontSize: 14, color: "var(--muted)" }}>
          🪙 {coins.toLocaleString()}
          <Link href="/studio" className="studio-link">
            스튜디오
          </Link>
        </div>
      )}
      {loggedOut && (
        <div style={{ textAlign: "right", fontSize: 14 }}>
          <Link href="/login" style={{ color: "var(--accent)" }}>
            로그인
          </Link>
        </div>
      )}
      <h2 className="section-title">세계</h2>
      <div className="h-scroll">
        <button
          className={`chip ${worldId === null ? "active" : ""}`}
          onClick={() => setWorldId(null)}
        >
          전체
        </button>
        {worlds.map((w) => (
          <button
            key={w.id}
            className={`world-card ${worldId === w.id ? "active" : ""}`}
            onClick={() => setWorldId(worldId === w.id ? null : w.id)}
          >
            {w.title_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.title_image_url} alt={w.name} className="title-img" />
            ) : (
              <div className="title-img placeholder" />
            )}
            <span>{w.name}</span>
          </button>
        ))}
      </div>

      {talked.length > 0 && (
        <>
          <h2 className="section-title">내가 대화했던 캐릭터</h2>
          <div className="h-scroll">
            {talked.map((c) => (
              <CharCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2 className="section-title">전체 캐릭터</h2>
        <div className="sort-toggle">
          <button className={`sort-btn ${sort === "popular" ? "active" : ""}`} onClick={() => setSort("popular")}>
            인기순
          </button>
          <button className={`sort-btn ${sort === "newest" ? "active" : ""}`} onClick={() => setSort("newest")}>
            최신순
          </button>
        </div>
      </div>
      <div className="char-grid">
        {items.map((c) => (
          <CharCard key={c.id} c={c} />
        ))}
      </div>
      {loading && <p className="muted-center">불러오는 중...</p>}
      {loaded && !loading && items.length === 0 && <p className="empty">캐릭터가 없습니다</p>}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  );
}
