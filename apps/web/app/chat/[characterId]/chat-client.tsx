"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Msg {
  role: "user" | "assistant";
  content: string;
  illustrationUrl?: string | null;
}

interface Props {
  characterId: number;
  characterName: string;
  worldId: number;
  worldName: string;
  avatarUrl: string | null;
  /** illustrationId -> url (이력 복원용) */
  illustMap: Record<number, string>;
}

export default function ChatClient({
  characterId,
  characterName,
  worldId,
  worldName,
  avatarUrl,
  illustMap,
}: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 게스트 유저 보장 후 이력 로드
  useEffect(() => {
    (async () => {
      await fetch("/api/me");
      const res = await fetch(`/api/history?characterId=${characterId}`);
      const history: { role: "user" | "assistant"; content: string; illustrationId: number | null }[] =
        await res.json();
      setMessages(
        history.map((h) => ({
          role: h.role,
          content: h.content,
          illustrationUrl: h.illustrationId ? illustMap[h.illustrationId] ?? null : null,
        }))
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, streaming]);

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

      const reader = res.body.getReader();
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
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
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
        <Link href={`/worlds/${worldId}`} className="back">←</Link>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={characterName} />
        ) : null}
        <div>
          <div className="name">{characterName}</div>
          <div className="world">{worldName}</div>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <p className="empty">{characterName}에게 첫 인사를 건네보세요.</p>
        )}
        {messages.map((m, idx) => (
          <div key={idx}>
            <div className={`msg ${m.role === "user" ? "user" : "ai"}`}>
              <div className="bubble">{m.content || (streaming && idx === messages.length - 1 ? "…" : "")}</div>
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
