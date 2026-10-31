/** 업로드 허용 이미지 MIME → 확장자 화이트리스트. 파일명이 아닌 MIME 기준으로 확장자를 정한다 (파일명 위조 방지). */
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** 허용된 이미지 MIME 이면 저장용 확장자, 아니면 null */
export function imageExtFromMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  return IMAGE_EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

/** 업로드 허용 영상 MIME → 확장자 화이트리스트 */
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** 허용된 영상 MIME 이면 저장용 확장자, 아니면 null */
export function videoExtFromMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  return VIDEO_EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

/** URL 확장자가 영상(mp4/webm)인지 — 일러스트 media_type 없이 URL 만 있을 때의 표시 판별용 */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|webm)(\?|#|$)/i.test(url);
}
