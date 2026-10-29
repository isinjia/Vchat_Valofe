import { getStorageSettings } from "../settings";
import type { StorageAdapter } from "./adapter";
import { S3Storage } from "./s3";
import { FtpStorage } from "./ftp";

export type { StorageAdapter } from "./adapter";
export { S3Storage } from "./s3";
export { FtpStorage } from "./ftp";

/** 관리자 설정(app_settings.storage)에 따라 스토리지 어댑터를 생성 */
export async function getStorage(): Promise<StorageAdapter> {
  const settings = await getStorageSettings();
  if (!settings) {
    throw new Error("스토리지가 설정되지 않았습니다. 관리자 > 설정에서 S3 또는 FTP 를 등록하세요.");
  }
  if (settings.type === "s3") {
    if (!settings.s3) throw new Error("S3 설정이 비어 있습니다.");
    return new S3Storage(settings.s3);
  }
  if (!settings.ftp) throw new Error("FTP 설정이 비어 있습니다.");
  return new FtpStorage(settings.ftp);
}
