import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { S3Config } from "../types";
import type { StorageAdapter } from "./adapter";

export class S3Storage implements StorageAdapter {
  private client: S3Client;

  constructor(private config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: !!config.endpoint, // MinIO 등 S3 호환 스토리지용
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return this.publicUrl(key);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })
    );
  }

  publicUrl(key: string): string {
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    if (this.config.endpoint) {
      return `${this.config.endpoint.replace(/\/$/, "")}/${this.config.bucket}/${key}`;
    }
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }
}
