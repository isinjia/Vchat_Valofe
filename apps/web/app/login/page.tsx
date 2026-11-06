import { redirect } from "next/navigation";
import { getAppEnv } from "@/lib/vfun";
import { devAutoLoginUid } from "@/lib/user";
import LoginClient from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // live 는 vfun 공식 로그인 페이지로 이동
  if (getAppEnv() === "live") redirect("https://vfunkr.valofe.com/");
  // 개발 자동 로그인 중에는 로그인 화면이 필요 없다
  if (devAutoLoginUid()) redirect("/");
  const { error } = await searchParams;
  return <LoginClient initialError={error ?? null} />;
}
