"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CoinIcon from "./CoinIcon";

interface Me {
  nickname: string;
  coins: number;
  profileImage: string | null;
  tierName: string | null;
  tierIcon: string | null;
  /** 코인 충전 페이지 링크 (관리자 설정, 빈 값이면 준비 중 모달) */
  chargeUrl: string;
}

interface Notice {
  id: number;
  type: string;
  title: string;
  body: string | null;
}

// 상단 고정 헤더: 서비스 타이틀 / 코인 잔액 / 유저 메뉴 / 충전 모달
export default function SiteHeader() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  // 낮/밤 스킨 (localStorage 저장, layout 의 초기 스크립트가 첫 페인트 전에 적용)
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      if (localStorage.getItem("vc-theme") === "light") setTheme("light");
    } catch {
      // 무시
    }
  }, []);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem("vc-theme", next);
    } catch {
      // 무시
    }
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  };

  // 로그인 상태 조회 (401 → 비로그인)
  useEffect(() => {
    fetch("/api/me")
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        setMe({
          nickname: d.nickname ?? "",
          coins: typeof d.coins === "number" ? d.coins : 0,
          profileImage: d.profileImage ?? null,
          tierName: d.tierName ?? null,
          tierIcon: d.tierIcon ?? null,
          chargeUrl: typeof d.chargeUrl === "string" ? d.chargeUrl : "",
        });
        // 안 읽은 알림(등급 승급 등) → 토스트로 보여주고 읽음 처리
        try {
          const n = await fetch("/api/notifications").then((x) => (x.ok ? x.json() : null));
          const items: Notice[] = n?.items ?? [];
          if (items.length > 0) {
            setNotices(items);
            fetch("/api/notifications", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: items.map((i) => i.id) }),
            }).catch(() => {});
            setTimeout(() => setNotices([]), 8000);
          }
        } catch {
          // 알림 실패는 무시
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // 바깥 클릭 / Esc 로 메뉴·모달 닫기
  useEffect(() => {
    if (!menuOpen && !chargeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setChargeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, chargeOpen]);

  async function logout() {
    setMenuOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 네트워크 실패여도 화면은 비로그인으로 전환 후 서버 상태 재확인
    }
    setMe(null);
    router.refresh();
  }

  function openCharge() {
    setMenuOpen(false);
    // 관리자 설정에 충전 링크가 있으면 그 페이지로, 없으면 안내 모달
    if (me?.chargeUrl) {
      window.open(me.chargeUrl, "_blank", "noopener");
      return;
    }
    setChargeOpen(true);
  }

  return (
    <>
      <header className="site-header">
        <Link href="/" className="site-title">
          VChatBot
        </Link>
        <div className="header-right">
          <button
            className="header-btn"
            onClick={toggleTheme}
            title={theme === "light" ? "밤 스킨으로" : "낮 스킨으로"}
            aria-label="낮/밤 스킨 전환"
          >
            {theme === "light" ? "🌙" : "☀"}
          </button>
          {ready && me && (
            <>
              {me.tierName && (
                <span className="tier-badge" title="유저 등급">
                  {me.tierIcon ? (
                    me.tierIcon.startsWith("http") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={me.tierIcon} alt="" className="tier-icon" />
                    ) : (
                      <span>{me.tierIcon}</span>
                    )
                  ) : (
                    "🏅"
                  )}{" "}
                  {me.tierName}
                </span>
              )}
              <span className="header-coins"><CoinIcon /> {me.coins.toLocaleString()}</span>
              <button className="header-btn" onClick={openCharge}>
                충전
              </button>
              <div className="user-menu-wrap" ref={menuRef}>
                <button
                  className="header-btn user-btn"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  {me.profileImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.profileImage} alt="" className="header-avatar" />
                  )}
                  <span className="user-name">{me.nickname}</span>
                </button>
                {menuOpen && (
                  <div className="user-menu" role="menu">
                    <Link href="/studio" role="menuitem" onClick={() => setMenuOpen(false)}>
                      스튜디오
                    </Link>
                    <button role="menuitem" onClick={openCharge}>
                      충전
                    </button>
                    <button role="menuitem" onClick={logout}>
                      로그아웃
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {ready && !me && (
            <Link href="/login" className="header-btn">
              로그인
            </Link>
          )}
        </div>
      </header>

      {notices.length > 0 && (
        <div className="toast-stack">
          {notices.map((n) => (
            <div key={n.id} className="toast" onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}>
              <div className="toast-title">🎉 {n.title}</div>
              {n.body && <div className="toast-body">{n.body}</div>}
            </div>
          ))}
        </div>
      )}

      {chargeOpen && (
        <div className="modal-backdrop" onClick={() => setChargeOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>코인 충전</h3>
            <p>
              충전 기능은 준비 중입니다. 현재는 잔액이 10,000코인 미만이 되면 자동으로 100,000코인이
              지급됩니다.
            </p>
            <button className="header-btn" onClick={() => setChargeOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
