import mysql from "mysql2/promise";
import { env } from "./env";

// Next.js dev 핫리로드 시 커넥션 풀이 중복 생성되지 않도록 globalThis 에 캐시
const g = globalThis as unknown as { __vchatbotMysqlPool?: mysql.Pool };

export function getPool(): mysql.Pool {
  if (!g.__vchatbotMysqlPool) {
    g.__vchatbotMysqlPool = mysql.createPool({
      host: env("MYSQL_HOST", "127.0.0.1"),
      port: Number(env("MYSQL_PORT", "3306")),
      user: env("MYSQL_USER", "vchatbot"),
      password: env("MYSQL_PASSWORD", "vchatbot"),
      database: env("MYSQL_DATABASE", "vchatbot"),
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    });
  }
  return g.__vchatbotMysqlPool;
}

export type SqlParam = string | number | boolean | null | Date | Buffer;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}

export async function execute(
  sql: string,
  params: SqlParam[] = []
): Promise<mysql.ResultSetHeader> {
  const [result] = await getPool().execute(sql, params);
  return result as mysql.ResultSetHeader;
}
