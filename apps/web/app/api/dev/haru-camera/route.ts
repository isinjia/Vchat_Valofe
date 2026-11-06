import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 개발 전용: 하루 방송 화면에서 "이 구도로 저장"을 누르면 카메라 값을 public/haru/camera.json 에 기록한다.
 * 운영 빌드에서는 막는다. 저장된 파일은 모든 방문자의 기본 구도가 된다.
 */
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "public", "haru", "camera.json");

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => Number(x));
  if (out.some((x) => !Number.isFinite(x) || Math.abs(x) > 50)) return null;
  return [out[0], out[1], out[2]];
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "개발 모드에서만 저장할 수 있습니다." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { position?: unknown; target?: unknown; fov?: unknown } | null;
  const position = vec3(body?.position);
  const target = vec3(body?.target);
  const fov = Number(body?.fov);
  if (!position || !target || !Number.isFinite(fov) || fov < 10 || fov > 90) {
    return Response.json({ error: "카메라 값이 올바르지 않습니다." }, { status: 400 });
  }
  const round = (a: number[]) => a.map((x) => Math.round(x * 1000) / 1000);
  const data = { position: round(position), target: round(target), fov: Math.round(fov * 10) / 10, savedAt: new Date().toISOString() };
  await fs.writeFile(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
  return Response.json({ ok: true, camera: data });
}
