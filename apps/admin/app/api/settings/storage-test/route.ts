import { NextRequest, NextResponse } from "next/server";
import { S3Storage, FtpStorage, type StorageAdapter, type StorageSettings } from "@vchatbot/core";

export const runtime = "nodejs";

const fail = (stage: "config" | "upload" | "fetch", error: string, url?: string) =>
  NextResponse.json({ ok: false, stage, error, url });

/** 테스트 파일 삭제 — 실패해도 테스트 결과에는 영향 없음 (수동 삭제 대상만 남음) */
const cleanup = async (adapter: StorageAdapter, key: string) => {
  try {
    await adapter.remove(key);
  } catch {
    /* ignore */
  }
};

/**
 * 스토리지/CDN 테스트 — 화면에 입력된(저장 전일 수 있는) 설정으로
 * 실제 업로드 → 공개 URL(CDN) 조회 → 내용 일치 확인 → 테스트 파일 삭제까지 수행한다.
 */
export async function POST(req: NextRequest) {
  let storage: StorageSettings | undefined;
  try {
    storage = (await req.json())?.storage;
  } catch {
    return fail("config", "요청 본문이 올바르지 않습니다.");
  }

  let adapter: StorageAdapter;
  if (storage?.type === "s3") {
    if (!storage.s3?.bucket) return fail("config", "S3 Bucket 이 비어 있습니다.");
    if (!storage.s3.accessKeyId || !storage.s3.secretAccessKey) return fail("config", "S3 Access Key / Secret 이 비어 있습니다.");
    adapter = new S3Storage(storage.s3);
  } else if (storage?.type === "ftp") {
    if (!storage.ftp?.host) return fail("config", "FTP Host 가 비어 있습니다.");
    if (!storage.ftp.publicBaseUrl) return fail("config", "FTP 는 공개 URL prefix 가 필수입니다.");
    adapter = new FtpStorage(storage.ftp);
  } else {
    return fail("config", "스토리지 설정이 올바르지 않습니다.");
  }

  // 매번 고유한 키 — CDN 캐시에 걸리지 않고 새 경로로 원본까지 도달하는지 확인
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key = `cdn-test/${stamp}.txt`;

  let url: string;
  try {
    url = await adapter.upload(key, Buffer.from(`vchatbot cdn test ${stamp}`, "utf8"), "text/plain");
  } catch (e) {
    return fail("upload", `업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status !== 200) return fail("fetch", `공개 URL 이 HTTP ${res.status} 를 반환했습니다.`, url);
    const text = await res.text();
    if (!text.includes(stamp)) return fail("fetch", "공개 URL 응답이 업로드한 테스트 파일과 다릅니다 (URL prefix/경로 확인).", url);
  } catch (e) {
    return fail("fetch", `공개 URL 조회 실패: ${e instanceof Error ? e.message : String(e)}`, url);
  } finally {
    await cleanup(adapter, key);
  }

  return NextResponse.json({ ok: true, url });
}
