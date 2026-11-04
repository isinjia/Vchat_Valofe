"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { tintBackground } from "@/lib/tint";
import CoinIcon from "../../../../components/CoinIcon";

interface SceneLine {
  who: "narr" | "char" | "player";
  text: string;
}

/** 프로필 아바타 구성 (chat-client 와 동일 형태 — 앱 관례상 사본) */
interface ProfileVisual {
  layers: string[];
  effect?: { url: string; scale: number; x: number; y: number } | null;
}

/** 레이어/효과를 겹쳐 그리는 원형 아바타. 레이어가 없으면 fallbackUrl 1장 */
function AvatarStack({
  visual,
  fallbackUrl,
  title,
  className,
}: {
  visual: ProfileVisual;
  fallbackUrl?: string | null;
  title?: string;
  className: string;
}) {
  const layers = visual.layers.length > 0 ? visual.layers : fallbackUrl ? [fallbackUrl] : [];
  if (layers.length === 0 && !visual.effect) return null;
  if (layers.length === 1 && !visual.effect) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={layers[0]} alt="" className={className} title={title} />;
  }
  return (
    <span className={`${className} avatar-stack`} title={title}>
      <span className="avatar-clip">
        {layers.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={u} alt="" />
        ))}
      </span>
      {visual.effect && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={visual.effect.url}
          alt=""
          className="avatar-effect"
          style={{
            width: `${visual.effect.scale * 100}%`,
            left: `${50 + visual.effect.x * 100}%`,
            top: `${50 + visual.effect.y * 100}%`,
          }}
        />
      )}
    </span>
  );
}

interface PlayView {
  status: "story" | "choice" | "finished";
  nodeId: string;
  title: string | null;
  text: string | null;
  imageUrl: string | null;
  options: { id: string; text: string }[] | null;
}

interface PlayState {
  title: string;
  titleImageUrl?: string | null;
  characterName?: string;
  status: "idle" | "active" | "finished";
  view: PlayView | null;
}

type Item =
  | { kind: "title"; text: string }
  | { kind: "image"; url: string }
  | { kind: "line"; line: SceneLine }
  | { kind: "cost"; text: string };

/**
 * 스토리 플레이어 — 카드의 "장면 설정"으로 AI 가 쓴 대화 장면(캐릭터+플레이어 대사)을
 * 기존 채팅과 같은 말풍선 형태로 보여준다. 플레이어도 입력하지 않는다 (선택지로만 개입).
 * 상단 타이틀은 현재 스토리 카드 타이틀로 실시간 변경. 변수 수치는 노출하지 않는다.
 */
export default function StoryPlayerClient({
  characterId,
  characterName,
  storyId,
  shareKey,
  avatarUrl = null,
  visual = null,
  worldColor = null,
  charColor = null,
}: {
  characterId: number;
  characterName: string;
  storyId: number;
  shareKey: string | null;
  avatarUrl?: string | null;
  /** 고급 프로필 아바타 구성 (없으면 avatarUrl 폴백) */
  visual?: ProfileVisual | null;
  /** 세계관 타이틀 컬러 — 배경 톤 (채팅창과 동일) */
  worldColor?: string | null;
  /** 캐릭터 타이틀 컬러 — 캐릭터 말풍선 톤 */
  charColor?: string | null;
}) {
  const [state, setState] = useState<PlayState | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [hidden, setHidden] = useState(0); // 마지막 N개 줄은 시간차 공개
  const [sceneLoading, setSceneLoading] = useState(false);
  const [headTitle, setHeadTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [chargeUrl, setChargeUrl] = useState("");
  const openedRef = useRef<string | null>(null); // 장면을 이미 붙인 노드 (중복 방지)
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const base = `/api/stories/${storyId}/play`;
  const kq = shareKey ? `?k=${encodeURIComponent(shareKey)}` : "";

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, k: shareKey ?? undefined }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, d };
    },
    [base, shareKey]
  );

  /** 스토리 카드 진입 → 장면(대화) 불러오기/생성 */
  const openScene = useCallback(
    async (view: PlayView) => {
      if (openedRef.current === view.nodeId) return;
      openedRef.current = view.nodeId;
      setItems((arr) => [
        ...arr,
        { kind: "title", text: view.title ?? "" },
        ...(view.imageUrl ? [{ kind: "image", url: view.imageUrl } as Item] : []),
      ]);
      setSceneLoading(true);
      const { ok, d } = await post({ action: "scene" });
      setSceneLoading(false);
      // 생성 실패 시 장면 설정 텍스트를 지문으로 보여주는 폴백 (플레이가 막히지 않게)
      const lines: SceneLine[] =
        ok && Array.isArray(d.lines) && d.lines.length > 0
          ? d.lines
          : (view.text ?? "")
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => ({ who: "narr" as const, text: t }));
      const appended: Item[] = lines.map((line) => ({ kind: "line", line }) as Item);
      if (ok && Number(d.cost) > 0) appended.push({ kind: "cost", text: `장면 생성 -${Number(d.cost).toLocaleString()}코인` });
      if (ok && typeof d.balance === "number") setCoinBalance(d.balance);
      setItems((arr) => [...arr, ...appended]);
      setHidden(appended.length);
    },
    [post]
  );

  const apply = useCallback(
    (d: PlayState) => {
      setState(d);
      if (d.view?.status === "story") {
        if (d.view.title) setHeadTitle(d.view.title);
        void openScene(d.view);
      } else if (!d.view) {
        setHeadTitle(d.title);
      }
    },
    [openScene]
  );

  useEffect(() => {
    fetch(`${base}${kq}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : apply(d)))
      .catch(() => setError("불러오기 실패"));
    // 헤더 코인 잔액 (채팅창과 동일하게 /api/me)
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.coins === "number") setCoinBalance(d.coins);
        if (typeof d?.chargeUrl === "string") setChargeUrl(d.chargeUrl);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  /* 시간차 공개 */
  useEffect(() => {
    if (hidden <= 0) return;
    const t = setTimeout(() => setHidden((h) => Math.max(0, h - 1)), 450);
    return () => clearTimeout(t);
  }, [hidden, items.length]);

  /* 새 내용이 보일 때마다 아래로 스크롤 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, hidden, sceneLoading, state?.status]);

  const act = async (action: string, optionId?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { ok, d } = await post({ action, optionId });
      if (!ok) setError(d.error ?? "오류가 발생했습니다.");
      else apply(d);
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setItems([]);
    setHidden(0);
    openedRef.current = null;
    await act("restart");
  };

  const choose = async (o: { id: string; text: string }) => {
    // 선택한 답을 플레이어 말풍선으로 즉시 반영
    setItems((arr) => [...arr, { kind: "line", line: { who: "player", text: o.text } }]);
    await act("choose", o.id);
  };

  if (error && !state) return <div className="container"><p className="empty">{error}</p></div>;
  if (!state) return <div className="container"><p className="muted-center">로딩 중...</p></div>;

  const view = state.view;
  const visibleItems = items.slice(0, items.length - hidden);
  const revealing = hidden > 0;

  const chatTint = tintBackground(worldColor, 0.1);
  const bubbleTint = tintBackground(charColor, 0.22);

  return (
    <div
      className="story-play"
      style={
        {
          ...(chatTint ? { background: chatTint } : {}),
          ...(bubbleTint ? { "--ai-bubble-char": bubbleTint } : {}),
        } as React.CSSProperties
      }
    >
      <header className="story-play-head">
        <Link href={`/chat/${characterId}${kq}`} className="back" title="채팅으로">←</Link>
        <AvatarStack visual={visual ?? { layers: [] }} fallbackUrl={avatarUrl} title={characterName} className="chat-avatar" />
        <div>
          {/* 현재 스토리 카드 타이틀 — 진행에 따라 실시간 변경 */}
          <div className="story-play-title">{headTitle || state.title}</div>
          <div className="story-play-sub">{characterName} · {state.title}</div>
        </div>
        {coinBalance !== null && (
          <div className="story-play-coins">
            <CoinIcon /> {coinBalance.toLocaleString()}
            {chargeUrl && (
              <a href={chargeUrl} target="_blank" rel="noreferrer" title="코인 충전">＋</a>
            )}
          </div>
        )}
      </header>

      <main
        className="story-play-chat"
        ref={scrollRef}
        onClick={() => revealing && setHidden(0) /* 클릭하면 남은 줄 한꺼번에 공개 */}
      >
        {state.status === "idle" && (
          <div className="story-play-card story-play-center">
            {state.titleImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="story-play-img" src={state.titleImageUrl} alt="" />
            )}
            <h3>{state.title}</h3>
            <p className="muted">선택에 따라 이야기가 달라지는 스토리 모드입니다.</p>
            <button className="story-play-btn" disabled={busy} onClick={() => act("start")}>스토리 시작</button>
          </div>
        )}

        {visibleItems.map((it, i) => {
          if (it.kind === "title") {
            return <div className="story-chat-divider" key={i}><span>{it.text}</span></div>;
          }
          if (it.kind === "image") {
            // eslint-disable-next-line @next/next/no-img-element
            return <img className="story-play-img" src={it.url} alt="" key={i} />;
          }
          if (it.kind === "cost") {
            return <p className="story-chat-cost" key={i}>{it.text}</p>;
          }
          const l = it.line;
          if (l.who === "narr") return <p className="story-chat-narr" key={i}>({l.text})</p>;
          return (
            <div className={`story-chat-row ${l.who === "player" ? "me" : "them"}`} key={i}>
              {l.who === "char" && (
                <AvatarStack visual={visual ?? { layers: [] }} fallbackUrl={avatarUrl} title={characterName} className="msg-avatar" />
              )}
              <div className="story-chat-bubble">{l.text}</div>
            </div>
          );
        })}

        {(sceneLoading || revealing) && (
          <p className="story-chat-typing">{sceneLoading ? "장면을 쓰는 중..." : "..."}</p>
        )}

        {state.status === "finished" && !revealing && (
          <div className="story-play-card story-play-center">
            <h3>— 끝 —</h3>
            <p className="muted">&quot;{state.title}&quot; 스토리를 끝까지 플레이했습니다.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="story-play-btn" disabled={busy} onClick={restart}>다시 하기</button>
              <Link href={`/chat/${characterId}${kq}`} className="story-play-btn story-play-btn-sub">채팅으로</Link>
            </div>
          </div>
        )}

        {error && <p style={{ color: "#e07070", textAlign: "center" }}>{error}</p>}
      </main>

      {/* 하단 액션 바 — 입력창 대신 진행/선택 버튼 (플레이어 대사는 AI 가 쓴다) */}
      <footer className="story-play-actions">
        {view?.status === "story" && state.status === "active" && (
          <button
            className="story-play-btn"
            style={{ alignSelf: "stretch", width: "100%" }}
            disabled={busy || sceneLoading || revealing}
            onClick={() => act("continue")}
          >
            {busy || sceneLoading ? "..." : revealing ? "장면 진행 중... (탭하면 빨리 보기)" : "계속 ▸"}
          </button>
        )}
        {view?.status === "choice" && !revealing && (
          <div className="story-play-choices" style={{ width: "100%" }}>
            {(view.options ?? []).map((o) => (
              <button key={o.id} className="story-play-choice" disabled={busy} onClick={() => choose(o)}>
                {o.text}
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
