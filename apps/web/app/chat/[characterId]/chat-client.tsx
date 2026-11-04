"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserLlmAvailability, streamBrowserLlm, type BrowserLlmAvailability } from "@/lib/browser-llm";
import { tintBackground } from "@/lib/tint";
import GiftModal, { type GiftUseResult } from "./GiftModal";
import CoinIcon from "../../components/CoinIcon";

interface Msg {
  role: "user" | "assistant";
  content: string;
  illustrationUrl?: string | null;
  /** 게스트 난입 말풍선의 발화자 이름 */
  guestName?: string;
  /** 날짜 구분선/시간 표시용 */
  createdAt?: string | Date;
  /** 채점된 캐릭터 감정 (감정별 프로필 이미지 선택용) */
  emotion?: string | null;
}

/** 같은 날인지 비교용 키 (로컬 시간대) */
const dateKey = (d?: string | Date) => {
  if (!d) return "";
  const t = new Date(d);
  return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
};
const dateLabel = (d: string | Date) =>
  new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const timeLabel = (d?: string | Date) =>
  d ? new Date(d).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "";

/** 캐릭터 응답의 한 조각: 대사(say)는 말풍선, (…) 상황 설명(narr)은 지문 스타일 */
interface Segment {
  kind: "say" | "narr";
  text: string;
}

/**
 * 캐릭터 응답을 줄 단위로 분해한다. 괄호(또는 RP 관행인 *별표*)로 감싼 줄은 상황 설명(지문), 나머지는 대사.
 * 스트리밍 중에는 닫는 괄호가 아직 안 왔을 수 있으므로 "( 로 시작 + ) 없음"도 지문으로 본다.
 * "(웃으며) 안녕" 처럼 중간에 닫히는 줄이나 형식을 안 지킨 출력은 대사 말풍선으로 그대로 표시한다 (유실 없음).
 */
function splitSegments(content: string): Segment[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parenWrapped = /^[(（].*[)）]$/.test(line) && !/[)）]/.test(line.slice(1, -1));
      const parenStreaming = /^[(（]/.test(line) && !/[)）]/.test(line);
      if (parenWrapped || parenStreaming) {
        return { kind: "narr" as const, text: line.replace(/^[(（]\s*/, "").replace(/\s*[)）]$/, "") };
      }
      // *행동 묘사* / **행동 묘사** 한 줄 전체 감싼 형태 (모델이 응답 형식을 어기는 흔한 관행)
      const starWrapped = /^\*{1,2}[^*].*[^*]\*{1,2}$/.test(line) && !/\*/.test(line.replace(/^\*{1,2}/, "").replace(/\*{1,2}$/, ""));
      if (starWrapped) {
        return { kind: "narr" as const, text: line.replace(/^\*{1,2}\s*/, "").replace(/\s*\*{1,2}$/, "") };
      }
      return { kind: "say" as const, text: line };
    });
}

const SEGMENT_REVEAL_MS = 550;

/**
 * 캐릭터 말풍선 묶음: 대사별로 상자를 나누고 지문은 따로 표시.
 * animate 면 처음 나타날 때 조각을 시간차(SEGMENT_REVEAL_MS)로 하나씩 공개한다 (이력은 즉시 전체 표시).
 */
function AiMessageBody({
  content,
  guest,
  animate,
  onReveal,
  avatar,
}: {
  content: string;
  guest: boolean;
  animate: boolean;
  onReveal: () => void;
  /** 대사 말풍선마다 앞에 붙일 프로필 아바타 (없으면 생략) */
  avatar?: React.ReactNode;
}) {
  const segments = splitSegments(content);
  const [shown, setShown] = useState(animate ? 0 : Number.MAX_SAFE_INTEGER);

  useEffect(() => {
    if (!animate || shown >= segments.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 0 : SEGMENT_REVEAL_MS);
    return () => clearTimeout(t);
  }, [animate, shown, segments.length]);

  // 조각이 새로 공개되면 스크롤 추적 (부모의 맨 아래 따라가기)
  useEffect(() => {
    if (animate) onReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return (
    <div className="bubble-stack">
      {segments.slice(0, shown).map((seg, i) =>
        seg.kind === "narr" ? (
          <div key={i} className={`narration${animate ? " seg-in" : ""}`}>{seg.text}</div>
        ) : (
          <div key={i} className={`bubble-row${animate ? " seg-in" : ""}`}>
            {avatar}
            <div className={`bubble${guest ? " guest" : ""}`}>{seg.text}</div>
          </div>
        )
      )}
    </div>
  );
}

/** 스토리 팝업의 목록 항목 */
interface StoryCardItem {
  id: number;
  title: string;
  titleImageUrl: string | null;
  likeCount: number;
  liked: boolean;
  runStatus: string | null;
  finishedCount: number;
}

/** 채팅창 위에 뜨는 스토리 선택 팝업 — 타이틀 이미지 + 제목/제작자 카드 목록 + 좋아요 */
function StoryListModal({
  characterId,
  shareKey,
  fallbackImage,
  onClose,
}: {
  characterId: number;
  shareKey: string | null;
  fallbackImage: string | null;
  onClose: () => void;
}) {
  const [creator, setCreator] = useState("");
  const [stories, setStories] = useState<StoryCardItem[] | null>(null);
  const kq = shareKey ? `?k=${encodeURIComponent(shareKey)}` : "";

  useEffect(() => {
    fetch(`/api/stories/character/${characterId}${kq}`)
      .then((r) => r.json())
      .then((d) => {
        setCreator(d.creator ?? "");
        setStories(Array.isArray(d.stories) ? d.stories : []);
      })
      .catch(() => setStories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const toggleLike = async (s: StoryCardItem) => {
    const r = await fetch(`/api/stories/${s.id}/like`, { method: "POST" });
    if (!r.ok) return;
    const d = await r.json();
    setStories((prev) =>
      prev ? prev.map((x) => (x.id === s.id ? { ...x, liked: !!d.liked, likeCount: Number(d.likeCount) } : x)) : prev
    );
  };

  return (
    <div className="story-modal-backdrop" onClick={onClose}>
      <div className="story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="story-modal-head">
          <strong>📖 스토리</strong>
          <button type="button" className="story-modal-x" onClick={onClose}>✕</button>
        </div>
        {stories == null && <p className="muted-center">불러오는 중...</p>}
        {stories != null && stories.length === 0 && <p className="muted-center">공개된 스토리가 없습니다.</p>}
        <div className="story-card-grid">
          {(stories ?? []).map((s) => (
            <Link key={s.id} href={`/chat/${characterId}/story/${s.id}${kq}`} className="story-card">
              <div className="story-card-img">
                {s.titleImageUrl || fallbackImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.titleImageUrl ?? fallbackImage ?? ""} alt="" />
                ) : (
                  <span className="story-card-img-ph">📖</span>
                )}
              </div>
              <div className="story-card-body">
                <div className="story-card-title">{s.title}</div>
                <div className="story-card-meta">제작: {creator}</div>
                <div className="story-card-foot">
                  <button
                    type="button"
                    className={`like-btn${s.liked ? " liked" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleLike(s);
                    }}
                    title={s.liked ? "좋아요 취소" : "좋아요"}
                  >
                    {s.liked ? "❤️" : "🤍"} {s.likeCount.toLocaleString()}
                  </button>
                  <span className="story-card-state">
                    {s.runStatus === "active" ? "진행 중" : s.finishedCount > 0 ? `완료 ${s.finishedCount}회` : "새로 시작"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 프로필 아바타 구성: 원 안 레이어(배경→얼굴) + 원 밖까지 덮는 효과 오버레이 */
interface ProfileVisual {
  layers: string[];
  effect?: { url: string; scale: number; x: number; y: number } | null;
}

/** 레이어/효과를 겹쳐 그리는 원형 아바타. 레이어가 없으면 fallbackUrl 1장을 쓴다 */
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

interface LevelInfo {
  id: number;
  level: number;
  name: string;
  description: string | null;
  kind: "browser" | "server";
  cost: number;
}

/** AI 레벨 선택 드롭다운 — 닫힌 상태는 Lv 배지(+데스크탑은 이름), 펼치면 이름·비용·설명 카드 목록 */
function LevelPicker({
  levels,
  disabled,
  browserAllowed,
  onChange,
}: {
  levels: LevelsPayload;
  disabled: boolean;
  /** 이 캐릭터가 브라우저 AI(크롬 내장) 레벨을 허용하는지 — 아니면 해당 레벨 선택 불가 */
  browserAllowed: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭/Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = levels.levels.find((l) => l.id === levels.selectedId) ?? null;
  const effective = levels.levels.find((l) => l.id === levels.effectiveId) ?? null;
  const shown = selected ?? effective;

  const pick = (value: string) => {
    setOpen(false);
    onChange(value);
  };

  return (
    <div className="level-picker" ref={wrapRef}>
      <button
        type="button"
        className="level-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="채팅에 사용할 AI 레벨"
      >
        <span className="lv-badge">{shown ? `Lv.${shown.level}` : "AI"}</span>
        <span className="lv-btn-name">{shown ? shown.name : "기본 레벨"}</span>
        <span className="lv-caret" aria-hidden>▴</span>
      </button>
      {open && (
        <div className="level-menu" role="listbox">
          <div className="level-menu-head">AI 레벨 — 매 응답마다 코인이 차감됩니다</div>
          <button
            type="button"
            className={`level-item${levels.selectedId == null ? " on" : ""}`}
            onClick={() => pick("")}
            role="option"
            aria-selected={levels.selectedId == null}
          >
            <span className="lv-badge">자동</span>
            <span className="lv-body">
              <span className="lv-row">
                <b>기본 레벨</b>
                {effective && <span className="lv-cost"><CoinIcon size={12} /> {effective.cost.toLocaleString()}</span>}
              </span>
              <span className="lv-desc">{effective ? `지금은 Lv.${effective.level} ${effective.name} 가 적용됩니다` : "운영 기본 설정을 따릅니다"}</span>
            </span>
            {levels.selectedId == null && <span className="lv-check">✓</span>}
          </button>
          {levels.levels.map((l) => {
            // 브라우저 레벨은 캐릭터가 허용(압축 프로필 준비)한 경우에만 선택 가능
            const blocked = l.kind === "browser" && !browserAllowed;
            return (
              <button
                key={l.id}
                type="button"
                className={`level-item${levels.selectedId === l.id ? " on" : ""}`}
                onClick={() => !blocked && pick(String(l.id))}
                disabled={blocked}
                style={blocked ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                role="option"
                aria-selected={levels.selectedId === l.id}
              >
                <span className="lv-badge">Lv.{l.level}</span>
                <span className="lv-body">
                  <span className="lv-row">
                    <b>{l.name}</b>
                    {l.kind === "browser" && <span className="lv-tag">내 PC</span>}
                    <span className="lv-cost"><CoinIcon size={12} /> {l.cost.toLocaleString()}</span>
                  </span>
                  {blocked ? (
                    <span className="lv-desc">이 캐릭터는 브라우저 AI 를 지원하지 않습니다</span>
                  ) : (
                    l.description && <span className="lv-desc">{l.description}</span>
                  )}
                </span>
                {levels.selectedId === l.id && <span className="lv-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
interface LevelsPayload {
  levels: LevelInfo[];
  selectedId: number | null;
  effectiveId: number | null;
  effectiveKind: "browser" | "server";
  discount: number;
}

interface Props {
  characterId: number;
  characterName: string;
  worldName: string;
  avatarUrl: string | null;
  /** illustrationId -> url (이력 복원용) */
  illustMap: Record<number, string>;
  /** 캐릭터 좋아요 수 초기값 */
  likeCount: number;
  /** 프로필 이미지: emotion 키('default', joy, sad, ...) -> 아바타 구성. 없으면 빈 객체 */
  profileMap: Record<string, ProfileVisual>;
  /** 세계관 타이틀 컬러 — 채팅창 배경 톤 */
  worldColor?: string | null;
  /** 캐릭터 타이틀 컬러(없으면 세계관 컬러) — 캐릭터 말풍선 톤 */
  charColor?: string | null;
  /** 이 캐릭터가 브라우저 AI(크롬 내장) 레벨을 허용하는지 */
  browserAllowed?: boolean;
  /** 유저에게 보여줄 세계관 설명 */
  worldDescription?: string | null;
  /** 유저에게 보여줄 캐릭터 프로필 */
  characterProfile?: string | null;
  /** 대화 시작 상황 설정 (있으면 소개에 함께 표시) */
  scenario?: string | null;
  /** 공개된 스토리 수 — 1개 이상이면 헤더에 스토리 플레이 버튼 표시 */
  storyCount?: number;
  /** 비공개 캐릭터 공유 키 (스토리 링크에 전달) */
  shareKey?: string | null;
}

export default function ChatClient({
  characterId,
  characterName,
  worldName,
  avatarUrl,
  illustMap,
  likeCount: initialLikeCount,
  profileMap,
  worldColor,
  charColor,
  browserAllowed = false,
  worldDescription,
  characterProfile,
  scenario,
  storyCount = 0,
  shareKey = null,
}: Props) {
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(false); // 세계관/캐릭터 소개 모달
  const [storyOpen, setStoryOpen] = useState(false); // 스토리 선택 팝업
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [likeBusy, setLikeBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/characters/${characterId}/like`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setLiked(!!d.liked);
          setLikeCount(d.likeCount);
        }
      })
      .catch(() => {});
  }, [characterId]);

  const toggleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      const r = await fetch(`/api/characters/${characterId}/like`, { method: "POST" });
      if (r.status === 401) {
        router.push("/login");
        return;
      }
      if (r.ok) {
        const d = await r.json();
        setLiked(!!d.liked);
        setLikeCount(d.likeCount);
      }
    } catch {
      // 무시
    } finally {
      setLikeBusy(false);
    }
  };
  const [messages, setMessages] = useState<Msg[]>([]);
  // 이력 로딩이 끝나기 전에는 "첫 인사" 안내 대신 로딩 중을 보여준다
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [chargeUrl, setChargeUrl] = useState<string>(""); // 코인 충전 페이지 (관리자 설정)
  const [giftOpen, setGiftOpen] = useState(false); // 선물하기 모달
  // 최근 호감도 변화량 (3초간 표시 — 수치는 유저에게 노출하지 않음)
  const [affinityDelta, setAffinityDelta] = useState<number>(0);
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AI 레벨 선택 (브라우저 레벨이면 크롬 내장 LLM 으로 생성)
  const [levels, setLevels] = useState<LevelsPayload | null>(null);
  const [browserAvail, setBrowserAvail] = useState<BrowserLlmAvailability | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  // 등급 승급 토스트
  const [tierToast, setTierToast] = useState<string | null>(null);
  const tierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // React StrictMode 의 effect 이중 실행으로 오프닝이 두 번 호출되는 것을 방지
  const openingStarted = useRef(false);
  // 이 인덱스 이상의 메시지(입장 후 새로 받은 것)만 조각 시간차 공개 애니메이션 적용
  const initialCountRef = useRef<number | null>(null);

  const browserMode = levels?.effectiveKind === "browser";

  const loadLevels = async (): Promise<LevelsPayload | null> => {
    try {
      const r = await fetch("/api/chat/levels");
      if (!r.ok) return null;
      const p: LevelsPayload = await r.json();
      setLevels(p);
      if (p.effectiveKind === "browser") {
        setBrowserAvail(await browserLlmAvailability());
      }
      return p;
    } catch {
      return null;
    }
  };

  // 로그인 확인(미로그인 시 /login) 후 이력 로드
  useEffect(() => {
    (async () => {
      const me = await fetch("/api/me");
      if (me.status === 401) {
        router.replace("/login");
        return;
      }
      // 입장 즉시 헤더에 코인 잔액 표시 (이후에는 채팅/선물 응답이 갱신)
      me.json().then((d) => {
        if (typeof d?.coins === "number") setCoinBalance(d.coins);
        if (typeof d?.chargeUrl === "string") setChargeUrl(d.chargeUrl);
      }).catch(() => {});
      const levelsPayload = await loadLevels();
      const res = await fetch(`/api/history?characterId=${characterId}`);
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const history: {
        role: "user" | "assistant";
        content: string;
        illustrationId: number | null;
        guestName?: string | null;
        createdAt?: string;
        emotion?: string | null;
      }[] = await res.json();
      setHistoryLoaded(true);
      // 이력까지는 즉시 전체 표시, 그 이후 새로 받는 응답부터 조각 시간차 공개
      if (initialCountRef.current === null) initialCountRef.current = history.length;
      // 오프닝이 이미 시작됐다면(StrictMode 중복 실행) 스트리밍 중인 말풍선을 덮어쓰지 않는다
      if (openingStarted.current) return;
      setMessages(
        history.map((h) => ({
          role: h.role,
          content: h.content,
          guestName: h.guestName ?? undefined,
          illustrationUrl: h.illustrationId ? illustMap[h.illustrationId] ?? null : null,
          createdAt: h.createdAt,
          emotion: h.emotion ?? null,
        }))
      );
      if (history.length === 0) {
        // 첫 대화: 이 캐릭터/세계관을 모르는 유저를 위해 소개를 자동으로 띄운다 (StrictMode 중복 호출은 openingStarted 가드가 막음)
        setInfoOpen(true);
        await startOpening(levelsPayload);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  // 유저가 위로 스크롤해 읽는 중이면 자동 스크롤을 멈추고 '맨 아래로' 버튼을 띄운다
  const [showJump, setShowJump] = useState(false);
  const atBottomRef = useRef(true);
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < 80;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };
  const jumpToBottom = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setShowJump(false);
  };

  useEffect(() => {
    if (atBottomRef.current) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, streaming]);

  /** 조각이 시간차로 공개될 때도 맨 아래를 따라간다 (위로 스크롤해 읽는 중이면 유지) */
  const followBottom = () => {
    if (atBottomRef.current) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  };

  /** SSE 응답을 읽어 마지막 assistant 말풍선에 반영 (send / 오프닝 / 브라우저 반납 공용) */
  const consumeSse = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "text") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + event.delta };
            return next;
          });
        } else if (event.type === "illustration") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, illustrationUrl: event.url };
            return next;
          });
        } else if (event.type === "guest") {
          // 게스트 난입: 스트리밍 말풍선과 별개로 새 말풍선 append
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: event.text, guestName: event.name, createdAt: new Date() },
          ]);
        } else if (event.type === "coin") {
          setCoinBalance(event.balance);
        } else if (event.type === "affinity") {
          setAffinityDelta(event.delta ?? 0);
          if (deltaTimer.current) clearTimeout(deltaTimer.current);
          deltaTimer.current = setTimeout(() => setAffinityDelta(0), 3000);
        } else if (event.type === "emotion") {
          // 감정별 프로필 교체: 마지막 assistant(비게스트) 말풍선에 감정 기록
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "assistant" && !next[i].guestName) {
                next[i] = { ...next[i], emotion: event.emotion };
                break;
              }
            }
            return next;
          });
        } else if (event.type === "event") {
          // 이벤트 성공/실패 토스트
          setTierToast(
            event.status === "success"
              ? `🎉 이벤트 성공 — ${event.name}`
              : `💧 이벤트 실패 — ${event.name}${event.retryHours ? ` (약 ${event.retryHours}시간 후 다시 도전 가능)` : ""}`
          );
          if (tierTimer.current) clearTimeout(tierTimer.current);
          tierTimer.current = setTimeout(() => setTierToast(null), 6000);
          // 달성 지정 대사/이미지는 별도 말풍선으로
          if (event.line || event.illustrationUrl) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: event.line ?? "",
                illustrationUrl: event.illustrationUrl ?? null,
                createdAt: new Date(),
              },
            ]);
          }
        } else if (event.type === "tier") {
          // 등급 변경 알림 (유저/크리에이터, 우선 적용 등급은 '변경')
          const up = event.direction !== "changed";
          setTierToast(
            `${up ? "🎉" : "⚠️"} ${event.track === "creator" ? "크리에이터" : "유저"} 등급 ${up ? "상승" : "변경"} — ${event.name}`
          );
          if (tierTimer.current) clearTimeout(tierTimer.current);
          tierTimer.current = setTimeout(() => setTierToast(null), 6000);
        } else if (event.type === "error") {
          setError(event.message);
          // 스트림이 거의 시작하자마자 끊긴 경우: 서버에 저장되지 않은 짧은 꼬리 말풍선을 지워
          // 저장 상태와 화면을 일치시킨다 (길게 받다 끊긴 건 읽을 수 있게 남겨둔다)
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.content.trim().length < 10 && !last.illustrationUrl) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      }
    }
  };

  /** 브라우저 내장 LLM 으로 생성하며 마지막 assistant 말풍선에 스트리밍 반영. 완성 텍스트 반환 */
  const generateInBrowser = async (prep: { system: string; messages: { role: "user" | "assistant"; content: string }[] }) => {
    let acc = "";
    setDownloadPct(null);
    // 컨텍스트 한도 초과(세션 생성 실패)면 앞쪽 이력을 절반씩 버리고 재시도 (마지막 user 메시지는 유지)
    let msgs = prep.messages;
    for (;;) {
      try {
        for await (const delta of streamBrowserLlm(prep.system, msgs, (loaded) =>
          setDownloadPct(Math.min(100, Math.round(loaded * 100)))
        )) {
          acc += delta;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        }
        break;
      } catch (e) {
        const quota = /컨텍스트 한도/.test((e as Error)?.message ?? "");
        // 생성 도중 에러거나(이미 출력됨) 더 줄일 이력이 없으면 그대로 실패
        if (!quota || acc || msgs.length <= 1) throw e;
        msgs = msgs.slice(Math.ceil((msgs.length - 1) / 2));
      }
    }
    setDownloadPct(null);
    if (!acc.trim()) throw new Error("브라우저 AI 가 빈 응답을 반환했습니다.");
    return acc;
  };

  /** 브라우저 레벨 오프닝: prepare → 브라우저 생성 → complete */
  const startOpeningBrowser = async () => {
    const prepRes = await fetch("/api/chat/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, opening: true }),
    });
    const prep = await prepRes.json().catch(() => ({}));
    if (!prepRes.ok) throw new Error(prep.error ?? `요청 실패 (${prepRes.status})`);
    if (!prep.started) return;
    setMessages([{ role: "assistant", content: "", createdAt: new Date() }]);
    const assistantText = await generateInBrowser(prep);
    const res = await fetch("/api/chat/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, opening: true, assistantText }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `반납 실패 (${res.status})`);
    }
    await consumeSse(res.body);
  };

  /** 이력이 비어 있을 때 오프닝(제작자 인사말 또는 AI 생성 첫 대사) 요청 */
  const startOpening = async (levelsPayload?: LevelsPayload | null) => {
    if (openingStarted.current) return;
    openingStarted.current = true;
    setError(null);
    setStreaming(true);
    try {
      const res = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const isSse = res.headers.get("Content-Type")?.includes("text/event-stream");
      if (!res.ok || !res.body || !isSse) {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `요청 실패 (${res.status})`);
        }
        // {started:false} — 단, 브라우저 레벨이면 서버가 browserOpening 으로 안내
        const json = await res.json().catch(() => ({}));
        if (json?.browserOpening) await startOpeningBrowser();
        return;
      }
      setMessages([{ role: "assistant", content: "", createdAt: new Date() }]);
      await consumeSse(res.body);
    } catch (e) {
      setError((e as Error).message);
      setMessages((prev) =>
        prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1].content
          ? prev.slice(0, -1)
          : prev
      );
    } finally {
      setStreaming(false);
    }
  };

  /** 브라우저 레벨 전송: prepare → 브라우저 생성 → complete */
  const sendBrowser = async (text: string) => {
    const prepRes = await fetch("/api/chat/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, message: text }),
    });
    const prep = await prepRes.json().catch(() => ({}));
    if (!prepRes.ok) throw new Error(prep.error ?? `요청 실패 (${prepRes.status})`);
    const assistantText = await generateInBrowser(prep);
    const res = await fetch("/api/chat/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, message: text, assistantText }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `반납 실패 (${res.status})`);
    }
    await consumeSse(res.body);
  };

  const send = async (preset?: string, presetIllustUrl?: string | null) => {
    const text = (preset ?? input).trim();
    if (!text || streaming) return;
    if (!preset) setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, createdAt: new Date(), illustrationUrl: presetIllustUrl ?? null },
      { role: "assistant", content: "", createdAt: new Date() },
    ]);
    setStreaming(true);

    try {
      if (browserMode) {
        await sendBrowser(text);
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, message: text }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `요청 실패 (${res.status})`);
        }
        await consumeSse(res.body);
      }
    } catch (e) {
      setError((e as Error).message);
      // 빈 assistant 말풍선 제거 + 브라우저 생성 실패 시 유저 말풍선도 걷고 입력을 복원해 재시도하기 쉽게
      setMessages((prev) => {
        let next = prev;
        const last = next[next.length - 1];
        if (last?.role === "assistant" && !last.content) next = next.slice(0, -1);
        if (browserMode) {
          const u = next[next.length - 1];
          if (u?.role === "user" && u.content === text) {
            next = next.slice(0, -1);
            setInput(text);
          }
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  const changeLevel = async (value: string) => {
    try {
      const r = await fetch("/api/chat/levels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levelId: value === "" ? null : Number(value) }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(p.error ?? "AI 레벨 변경 실패");
        return;
      }
      setLevels(p);
      if (p.effectiveKind === "browser") setBrowserAvail(await browserLlmAvailability());
      else setBrowserAvail(null);
    } catch {
      setError("AI 레벨 변경 실패");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const browserUnavailable = browserMode && browserAvail === "unavailable";

  /** 선물 사용 완료: 잔액/호감도 반영 + 캐릭터가 반응하도록 선물 메시지 자동 전송 (큰 이미지 연출 포함) */
  const onGiftUsed = (r: GiftUseResult) => {
    setCoinBalance(r.balance);
    if (r.affinityDelta !== 0) {
      setAffinityDelta(r.affinityDelta);
      if (deltaTimer.current) clearTimeout(deltaTimer.current);
      deltaTimer.current = setTimeout(() => setAffinityDelta(0), 4000);
    }
    send(`(${r.item.name}을(를) 선물로 건넨다)`, r.item.image_url ?? null);
  };

  // 채팅창 배경 = 세계관 컬러, 캐릭터 말풍선 = 캐릭터 컬러(없으면 세계관 컬러)를 테마 배경에 블렌딩
  const chatTint = tintBackground(worldColor, 0.1);
  const bubbleTint = tintBackground(charColor, 0.22);

  return (
    <div
      className="chat-page"
      style={
        {
          ...(chatTint ? { background: chatTint } : {}),
          ...(bubbleTint ? { "--ai-bubble-char": bubbleTint } : {}),
        } as React.CSSProperties
      }
    >
      <header className="chat-header">
        <Link href="/" className="back">←</Link>
        {/* 헤더 아바타: 고급 프로필(기본 감정 기준) → 기본 프로필 → 기본 일러스트 */}
        {profileMap["default"] ? (
          <AvatarStack visual={profileMap["default"]} fallbackUrl={avatarUrl} title={characterName} className="chat-avatar" />
        ) : avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={characterName} />
        ) : null}
        <div>
          <div className="name">
            {characterName}
            {/* 호감도는 수치 대신 변화가 있을 때만 잠깐 분위기로 보여준다 */}
            {affinityDelta !== 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: affinityDelta > 0 ? "#6bcf8f" : "#e07070",
                }}
              >
                {affinityDelta > 0 ? "♥ 호감도가 오른 것 같다" : "💔 호감도가 내려간 것 같다"}
              </span>
            )}
            <button
              type="button"
              className={`like-btn${liked ? " liked" : ""}`}
              onClick={toggleLike}
              disabled={likeBusy}
              title={liked ? "좋아요 취소" : "좋아요"}
              style={{ marginLeft: 8 }}
            >
              {liked ? "❤️" : "🤍"} {likeCount.toLocaleString()}
            </button>
            <button
              type="button"
              className="like-btn"
              onClick={() => setInfoOpen(true)}
              title="세계관 · 캐릭터 소개"
              style={{ marginLeft: 4 }}
            >
              ⓘ 소개
            </button>
            {storyCount > 0 && (
              <button
                type="button"
                className="like-btn"
                title="스토리 플레이"
                style={{ marginLeft: 4 }}
                onClick={() => setStoryOpen(true)}
              >
                📖 스토리
              </button>
            )}
          </div>
          <div className="world">{worldName}</div>
        </div>
        {coinBalance !== null && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <CoinIcon /> {coinBalance.toLocaleString()}
            {chargeUrl && (
              <a
                href={chargeUrl}
                target="_blank"
                rel="noreferrer"
                title="코인 충전"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: "1px solid var(--border)",
                  color: "var(--accent)",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                +
              </a>
            )}
          </div>
        )}
      </header>

      {tierToast && (
        <div className="error-banner ok">
          {tierToast}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {browserUnavailable && (
        <div className="error-banner">
          이 브라우저에서는 내장 AI(Gemini Nano)를 쓸 수 없습니다. 최신 Chrome(지원 기기)이 필요합니다 — 위에서 다른 AI 레벨을 선택해 주세요.
        </div>
      )}
      {browserMode && !browserUnavailable && !browserAllowed && (
        <div className="error-banner warn">
          이 캐릭터는 브라우저 AI(크롬 내장) 레벨을 지원하지 않습니다. 위에서 다른 AI 레벨을 선택해 주세요.
        </div>
      )}
      {browserMode && browserAvail === "downloadable" && (
        <div className="error-banner warn">
          첫 사용 시 브라우저 AI 모델 다운로드가 필요합니다. 첫 메시지 전송 시 자동으로 받기 시작합니다.
        </div>
      )}
      {downloadPct !== null && (
        <div className="error-banner info">
          브라우저 AI 모델 다운로드 중... {downloadPct}%
        </div>
      )}

      <div className="chat-body" ref={bodyRef} onScroll={onBodyScroll}>
        {messages.length === 0 &&
          (historyLoaded ? (
            <p className="empty">{characterName}에게 첫 인사를 건네보세요.</p>
          ) : (
            <p className="empty">대화를 불러오는 중...</p>
          ))}
        {messages.map((m, idx) => {
          const prev = messages[idx - 1];
          const showDate = !!m.createdAt && dateKey(m.createdAt) !== dateKey(prev?.createdAt);
          const time = timeLabel(m.createdAt);
          // 감정별 프로필 → 기본 프로필 → 기본 일러스트 순으로 원형 아바타 결정 (게스트 발화는 제외)
          const visual =
            m.role === "assistant" && !m.guestName
              ? ((m.emotion && profileMap[m.emotion]) || profileMap["default"] || (avatarUrl ? { layers: [avatarUrl] } : null))
              : null;
          return (
            <div key={idx}>
              {showDate && <div className="date-divider">{dateLabel(m.createdAt!)}</div>}
              {m.guestName && <div className="guest-name">{m.guestName}</div>}
              <div className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                {m.role === "user" && time && <span className="msg-time">{time}</span>}
                {visual && !m.content && (
                  <AvatarStack visual={visual} fallbackUrl={avatarUrl} title={characterName} className="msg-avatar" />
                )}
                {m.role === "user" ? (
                  <div className="bubble">{m.content}</div>
                ) : m.content ? (
                  <AiMessageBody
                    content={m.content}
                    guest={!!m.guestName}
                    animate={idx >= (initialCountRef.current ?? Number.MAX_SAFE_INTEGER)}
                    onReveal={followBottom}
                    // 대사 말풍선이 나뉘어 출력될 때마다 각 말풍선 앞에 프로필 아바타
                    avatar={
                      visual ? (
                        <AvatarStack visual={visual} fallbackUrl={avatarUrl} title={characterName} className="msg-avatar" />
                      ) : undefined
                    }
                  />
                ) : (
                  <div className={`bubble${m.guestName ? " guest" : ""}`}>
                    {streaming && idx === messages.length - 1 ? "…" : ""}
                  </div>
                )}
                {m.role !== "user" && time && <span className="msg-time">{time}</span>}
              </div>
              {m.illustrationUrl &&
                (/\.(mp4|webm)(\?|#|$)/i.test(m.illustrationUrl) ? (
                  <video src={m.illustrationUrl} className="msg-illust" autoPlay loop muted playsInline controls />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.illustrationUrl} alt="" className="msg-illust" />
                ))}
            </div>
          );
        })}
      </div>

      {streaming && <div className="typing">{characterName} 입력 중...</div>}

      {storyOpen && (
        <StoryListModal
          characterId={characterId}
          shareKey={shareKey}
          fallbackImage={avatarUrl}
          onClose={() => setStoryOpen(false)}
        />
      )}

      {showJump && (
        <button type="button" className="jump-bottom" onClick={jumpToBottom} title="맨 아래로">
          ⬇ 맨 아래로
        </button>
      )}

      <div className="chat-input">
        {levels && <LevelPicker levels={levels} disabled={streaming} browserAllowed={browserAllowed} onChange={changeLevel} />}
        <button
          type="button"
          className="gift-btn"
          title="선물하기"
          onClick={() => setGiftOpen(true)}
          disabled={streaming}
        >
          🎁
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={1}
        />
        <button className="send-btn" onClick={() => send()} disabled={streaming || !input.trim() || browserUnavailable}>
          전송
        </button>
      </div>

      <GiftModal
        open={giftOpen}
        characterId={characterId}
        characterName={characterName}
        onClose={() => setGiftOpen(false)}
        onUsed={onGiftUsed}
      />

      {/* 세계관/캐릭터 소개 — 처음 온 유저가 무슨 대화를 할지 감을 잡을 수 있게 */}
      {infoOpen && (
        <div className="modal-backdrop" onClick={() => setInfoOpen(false)}>
          <div
            className="modal chat-info-modal"
            onClick={(e) => e.stopPropagation()}
            style={
              worldColor && /^#[0-9a-fA-F]{6}$/.test(worldColor)
                ? ({ "--world-color": worldColor } as React.CSSProperties)
                : undefined
            }
          >
            <div className="info-head">
              {profileMap["default"] ? (
                <AvatarStack visual={profileMap["default"]} fallbackUrl={avatarUrl} className="chat-avatar info-avatar" />
              ) : avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={characterName} className="chat-avatar info-avatar" />
              ) : null}
              <h3>{characterName}</h3>
              <span className="info-world-tag">{worldName}</span>
            </div>
            <div className="info-section">
              <div className="info-label">프로필</div>
              {characterProfile?.trim() ? (
                <p className="pre-wrap">{characterProfile}</p>
              ) : (
                <p>등록된 프로필이 없습니다.</p>
              )}
            </div>
            {scenario?.trim() && (
              <div className="info-section">
                <div className="info-label">지금 상황</div>
                <p className="pre-wrap">{scenario}</p>
              </div>
            )}
            <div className="info-section">
              <div className="info-label">세계관</div>
              {worldDescription?.trim() ? (
                <p className="pre-wrap">{worldDescription}</p>
              ) : (
                <p>등록된 세계관 설명이 없습니다.</p>
              )}
            </div>
            <button type="button" className="info-close" onClick={() => setInfoOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
