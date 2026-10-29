import { Client } from "basic-ftp";
import { Readable } from "stream";
import path from "path/posix";
import type { FtpConfig } from "../types";
import type { StorageAdapter } from "./adapter";

export class FtpStorage implements StorageAdapter {
  constructor(private config: FtpConfig) {}

  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(15000);
    try {
      await client.access({
        host: this.config.host,
        port: this.config.port || 21,
        user: this.config.user,
        password: this.config.password,
        secure: this.config.secure ?? false,
      });
      return await fn(client);
    } finally {
      client.close();
    }
  }

  async upload(key: string, body: Buffer, _contentType: string): Promise<string> {
    const remotePath = path.join(this.config.basePath || "/", key);
    await this.withClient(async (client) => {
      await client.ensureDir(path.dirname(remotePath));
      await client.uploadFrom(Readable.from(body), path.basename(remotePath));
    });
    return this.publicUrl(key);
  }

  async remove(key: string): Promise<void> {
    const remotePath = path.join(this.config.basePath || "/", key);
    await this.withClient((client) => client.remove(remotePath));
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }
}
