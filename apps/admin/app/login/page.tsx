"use client";

import { useState } from "react";

/** 관리툴 로그인 — vfun-kr 계정(id/pw). 관리자 권한(admin_role)이 있는 계정만 입장 가능 */
export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy || !username || (!password && !otp)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, otp: otp || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.otpRequired) {
        setOtpRequired(true);
        setError("OTP 코드를 입력하세요.");
        return;
      }
      if (!r.ok) {
        setError(d.error ?? "로그인 실패");
        return;
      }
      window.location.href = "/stats";
    } catch {
      setError("로그인 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">✦</div>
        <h1>VChatBot 관리자</h1>
        <p className="login-sub">vfun-kr 계정으로 로그인</p>

        <label>아이디</label>
        <input
          type="text"
          value={username}
          autoFocus
          placeholder="vfun 아이디"
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <label>비밀번호</label>
        <input
          type="password"
          value={password}
          placeholder="••••••••"
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {otpRequired && (
          <>
            <label>OTP 코드</label>
            <input
              type="text"
              value={otp}
              inputMode="numeric"
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </>
        )}

        {error && <div className="login-err">{error}</div>}

        <button type="button" className="login-btn" onClick={submit} disabled={busy || !username || (!password && !otp)}>
          {busy ? "로그인 중..." : "로그인"}
        </button>

        <p className="login-foot">관리자 권한이 지정된 계정만 입장할 수 있습니다.</p>
      </div>
    </div>
  );
}
