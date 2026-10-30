"use client";

export default function LogoutButton() {
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 실패해도 로그인 화면으로
    }
    window.location.href = "/login";
  };
  return (
    <button type="button" className="small btn-secondary" style={{ margin: "8px 20px 0" }} onClick={logout}>
      로그아웃
    </button>
  );
}
