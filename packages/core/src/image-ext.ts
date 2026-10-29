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
