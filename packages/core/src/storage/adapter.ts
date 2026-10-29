export interface StorageAdapter {
  /** 업로드 후 공개 URL 반환 */
  upload(key: string, body: Buffer, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}
