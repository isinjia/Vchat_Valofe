"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Me {
  nickname: string;
  coins: number;
  profileImage: string | null;
}

// 상단 고정 헤더: 서비스 타이틀 / 코인 잔액 / 유저 메뉴 / 충전 모달
export default function SiteHeader() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        });
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
    setChargeOpen(true);
  }

  return (
    <>
      <header className="site-header">
        <Link href="/" className="site-title">
          VChatBot
        </Link>
        <div className="header-right">
          {ready && me && (
            <>
              <span className="header-coins">🪙 {me.coins.toLocaleString()}</span>
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
