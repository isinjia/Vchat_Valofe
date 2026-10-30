"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserLlmAvailability, streamBrowserLlm, type BrowserLlmAvailability } from "@/lib/browser-llm";

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

interface LevelInfo {
  id: number;
  level: number;
  name: string;
  description: string | null;
  kind: "browser" | "server";
  cost: number;
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
  /** 프로필 이미지: emotion 키('default', joy, sad, ...) -> url. 없으면 빈 객체 */
  profileMap: Record<string, string>;
}

export default function ChatClient({
  characterId,
  characterName,
  worldName,
  avatarUrl,
  illustMap,
  likeCount: initialLikeCount,
  profileMap,
}: Props) {
  const router = useRouter();
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
      if (history.length === 0) await startOpening(levelsPayload);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, streaming]);

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
        }
      }
    }
  };

  /** 브라우저 내장 LLM 으로 생성하며 마지막 assistant 말풍선에 스트리밍 반영. 완성 텍스트 반환 */
  const generateInBrowser = async (prep: { system: string; messages: { role: "user" | "assistant"; content: string }[] }) => {
    let acc = "";
    setDownloadPct(null);
    for await (const delta of streamBrowserLlm(prep.system, prep.messages, (loaded) =>
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

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, createdAt: new Date() },
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

  const effectiveLevel = levels?.levels.find((l) => l.id === levels.effectiveId) ?? null;
  const browserUnavailable = browserMode && browserAvail === "unavailable";

  return (
    <div className="chat-page">
      <header className="chat-header">
        <Link href="/" className="back">←</Link>
        {avatarUrl ? (
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
          </div>
          <div className="world">{worldName}</div>
        </div>
        {coinBalance !== null && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            🪙 {coinBalance.toLocaleString()}
          </div>
        )}
      </header>

      {tierToast && (
        <div className="error-banner" style={{ background: "#1f3d2a", borderColor: "#2f7d4f", color: "#8fe0ae" }}>
          {tierToast}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {browserUnavailable && (
        <div className="error-banner">
          이 브라우저에서는 내장 AI(Gemini Nano)를 쓸 수 없습니다. 최신 Chrome(지원 기기)이 필요합니다 — 위에서 다른 AI 레벨을 선택해 주세요.
        </div>
      )}
      {browserMode && browserAvail === "downloadable" && (
        <div className="error-banner" style={{ background: "#3d3a1f", borderColor: "#7d742f", color: "#e0d88f" }}>
          첫 사용 시 브라우저 AI 모델 다운로드가 필요합니다. 첫 메시지 전송 시 자동으로 받기 시작합니다.
        </div>
      )}
      {downloadPct !== null && (
        <div className="error-banner" style={{ background: "#1f2f3d", borderColor: "#2f5a7d", color: "#8fc4e0" }}>
          브라우저 AI 모델 다운로드 중... {downloadPct}%
        </div>
      )}

      <div className="chat-body" ref={bodyRef}>
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
          const profileUrl =
            m.role === "assistant" && !m.guestName
              ? (m.emotion && profileMap[m.emotion]) || profileMap["default"] || avatarUrl
              : null;
          return (
            <div key={idx}>
              {showDate && <div className="date-divider">{dateLabel(m.createdAt!)}</div>}
              {m.guestName && <div className="guest-name">{m.guestName}</div>}
              <div className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                {m.role === "user" && time && <span className="msg-time">{time}</span>}
                {profileUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profileUrl} alt="" className="msg-avatar" title={characterName} />
                )}
                <div className={`bubble${m.guestName ? " guest" : ""}`}>{m.content || (streaming && idx === messages.length - 1 ? "…" : "")}</div>
                {m.role !== "user" && time && <span className="msg-time">{time}</span>}
              </div>
              {m.illustrationUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.illustrationUrl} alt="" className="msg-illust" />
              )}
            </div>
          );
        })}
      </div>

      {streaming && <div className="typing">{characterName} 입력 중...</div>}

      <div className="chat-input">
        {levels && (
          <select
            className="level-select"
            value={levels.selectedId ?? ""}
            onChange={(e) => changeLevel(e.target.value)}
            title={effectiveLevel ? `${effectiveLevel.name} — ${effectiveLevel.description ?? ""} (1회 ${effectiveLevel.cost.toLocaleString()}코인)` : "채팅에 사용할 AI 레벨"}
            disabled={streaming}
          >
            <option value="">기본 레벨</option>
            {levels.levels.map((l) => (
              <option key={l.id} value={l.id}>
                Lv.{l.level} {l.name} · {l.cost.toLocaleString()}🪙
              </option>
            ))}
          </select>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={1}
        />
        <button onClick={send} disabled={streaming || !input.trim() || browserUnavailable}>
          전송
        </button>
      </div>
    </div>
  );
}
