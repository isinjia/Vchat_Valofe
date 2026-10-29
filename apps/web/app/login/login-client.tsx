"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  auth: "인증에 실패했습니다. 다시 로그인해 주세요.",
  used: "이미 사용된 인증 코드입니다. 다시 로그인해 주세요.",
};

export default function LoginClient({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? ERRORS[initialError] ?? ERRORS.auth : null
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, otp: otpRequired ? otp : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.otpRequired) {
        setOtpRequired(true);
      } else if (res.ok && data.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(data.error || "로그인에 실패했습니다.");
      }
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    marginBottom: 10,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    fontSize: 15,
  };

  return (
    <div className="container" style={{ maxWidth: 380, marginTop: 80 }}>
      <form
        onSubmit={submit}
        style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}
      >
        <h2 style={{ marginBottom: 4 }}>로그인</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
          vfun 계정으로 로그인하세요 (개발/스테이지)
        </p>
        {error && (
          <div
            style={{
              background: "#3a1d24",
              color: "#ff8d9b",
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <input
          style={field}
          placeholder="아이디"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={otpRequired}
        />
        <input
          style={field}
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={otpRequired}
        />
        {otpRequired && (
          <input
            style={field}
            placeholder="OTP 인증번호"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            autoFocus
          />
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "10px 0",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          {busy ? "처리 중..." : otpRequired ? "OTP 확인" : "로그인"}
        </button>
      </form>
    </div>
  );
}
