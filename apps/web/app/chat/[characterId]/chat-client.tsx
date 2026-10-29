"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Msg {
  role: "user" | "assistant";
  content: string;
  illustrationUrl?: string | null;
  /** 게스트 난입 말풍선의 발화자 이름 */
  guestName?: string;
}

interface Props {
  characterId: number;
  characterName: string;
  worldName: string;
  avatarUrl: string | null;
  /** illustrationId -> url (이력 복원용) */
  illustMap: Record<number, string>;
}

export default function ChatClient({
  characterId,
  characterName,
  worldName,
  avatarUrl,
  illustMap,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [affinity, setAffinity] = useState<number | null>(null);
  // 최근 호감도 변화량 (3초간 표시)
  const [affinityDelta, setAffinityDelta] = useState<number>(0);
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // React StrictMode 의 effect 이중 실행으로 오프닝이 두 번 호출되는 것을 방지
  const openingStarted = useRef(false);

  // 로그인 확인(미로그인 시 /login) 후 이력 로드
  useEffect(() => {
    (async () => {
      const me = await fetch("/api/me");
      if (me.status === 401) {
        router.replace("/login");
        return;
      }
      const res = await fetch(`/api/history?characterId=${characterId}`);
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      // 현재 호감도 (실패해도 채팅은 계속)
      fetch(`/api/state?characterId=${characterId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (s && typeof s.affinity === "number") setAffinity(s.affinity);
        })
        .catch(() => {});
      const history: { role: "user" | "assistant"; content: string; illustrationId: number | null; guestName?: string | null }[] =
        await res.json();
      // 오프닝이 이미 시작됐다면(StrictMode 중복 실행) 스트리밍 중인 말풍선을 덮어쓰지 않는다
      if (openingStarted.current) return;
      setMessages(
        history.map((h) => ({
          role: h.role,
          content: h.content,
          guestName: h.guestName ?? undefined,
          illustrationUrl: h.illustrationId ? illustMap[h.illustrationId] ?? null : null,
        }))
      );
      if (history.length === 0) await startOpening();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, streaming]);

  /** SSE 응답을 읽어 마지막 assistant 말풍선에 반영 (send / 오프닝 공용) */
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
          setMessages((prev) => [...prev, { role: "assistant", content: event.text, guestName: event.name }]);
        } else if (event.type === "coin") {
          setCoinBalance(event.balance);
        } else if (event.type === "affinity") {
          setAffinity(event.value);
          setAffinityDelta(event.delta ?? 0);
          if (deltaTimer.current) clearTimeout(deltaTimer.current);
          deltaTimer.current = setTimeout(() => setAffinityDelta(0), 3000);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    }
  };

  /** 이력이 비어 있을 때 오프닝(제작자 인사말 또는 AI 생성 첫 대사) 요청 */
  const startOpening = async () => {
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
        // {started:false} 등 JSON 응답이면 아무것도 하지 않음. 오류만 표시
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `요청 실패 (${res.status})`);
        }
        return;
      }
      setMessages([{ role: "assistant", content: "" }]);
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

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
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
    } catch (e) {
      setError((e as Error).message);
      // 빈 assistant 말풍선 제거
      setMessages((prev) =>
        prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1].content
          ? prev.slice(0, -1)
          : prev
      );
    } finally {
      setStreaming(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

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
            {affinity !== null && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: affinity >= 0 ? "#6bcf8f" : "#e07070",
                }}
              >
                ♥ {affinity}
                {affinityDelta !== 0 && ` (${affinityDelta > 0 ? "+" : ""}${affinityDelta})`}
              </span>
            )}
          </div>
          <div className="world">{worldName}</div>
        </div>
        {coinBalance !== null && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            🪙 {coinBalance.toLocaleString()}
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <p className="empty">{characterName}에게 첫 인사를 건네보세요.</p>
        )}
        {messages.map((m, idx) => (
          <div key={idx}>
            {m.guestName && <div className="guest-name">{m.guestName}</div>}
            <div className={`msg ${m.role === "user" ? "user" : "ai"}`}>
              <div className={`bubble${m.guestName ? " guest" : ""}`}>{m.content || (streaming && idx === messages.length - 1 ? "…" : "")}</div>
            </div>
            {m.illustrationUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.illustrationUrl} alt="" className="msg-illust" />
            )}
          </div>
        ))}
      </div>

      {streaming && <div className="typing">{characterName} 입력 중...</div>}

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={1}
        />
        <button onClick={send} disabled={streaming || !input.trim()}>
          전송
        </button>
      </div>
    </div>
  );
}
