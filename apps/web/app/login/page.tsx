import { redirect } from "next/navigation";
import { getAppEnv } from "@/lib/vfun";
import LoginClient from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // live 는 vfun 공식 로그인 페이지로 이동
  if (getAppEnv() === "live") redirect("https://vfunkr.valofe.com/");
  const { error } = await searchParams;
  return <LoginClient initialError={error ?? null} />;
}
