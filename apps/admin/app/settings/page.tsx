"use client";

import { useEffect, useState } from "react";

interface Settings {
  storage: {
    type: "s3" | "ftp";
    s3: {
      region: string; bucket: string; accessKeyId: string; secretAccessKey: string;
      endpoint: string; publicBaseUrl: string;
    };
    ftp: {
      host: string; port: number; user: string; password: string;
      basePath: string; publicBaseUrl: string;
    };
  };
  llm: { model: string; maxTokens: number; historyLimit: number };
  /** 비율은 화면에서 % (0~100) 로 편집, 저장 시 0~1 */
  fees: { creatorRate: number; worldRate: number };
  pricing: { aiAssistCost: number; illustGenCost: number };
  /** apiKey 는 서버가 마스킹해서 내려주며, 수정하지 않으면 그대로 전송(서버가 기존 값 유지) */
  image_gen: { enabled: boolean; baseUrl: string; apiKey: string; model: string; size: string };
}

const EMPTY: Settings = {
  storage: {
    type: "s3",
    s3: { region: "ap-northeast-2", bucket: "", accessKeyId: "", secretAccessKey: "", endpoint: "", publicBaseUrl: "" },
    ftp: { host: "", port: 21, user: "", password: "", basePath: "/", publicBaseUrl: "" },
  },
  llm: { model: "claude-opus-5-5", maxTokens: 4096, historyLimit: 30 },
  fees: { creatorRate: 30, worldRate: 20 },
  pricing: { aiAssistCost: 50, illustGenCost: 500 },
  image_gen: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-image-1", size: "1024x1536" },
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setS({
          storage: {
            type: data.storage?.type ?? "s3",
            s3: { ...EMPTY.storage.s3, ...(data.storage?.s3 ?? {}) },
            ftp: { ...EMPTY.storage.ftp, ...(data.storage?.ftp ?? {}) },
          },
          llm: { ...EMPTY.llm, ...(data.llm ?? {}) },
          fees: {
            creatorRate: Math.round((data.fees?.creatorRate ?? 0.3) * 1000) / 10,
            worldRate: Math.round((data.fees?.worldRate ?? 0.2) * 1000) / 10,
          },
          pricing: { ...EMPTY.pricing, ...(data.pricing ?? {}) },
          image_gen: { ...EMPTY.image_gen, ...(data.image_gen ?? {}) },
        });
      });
  }, []);

  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s,
        fees: { creatorRate: s.fees.creatorRate / 100, worldRate: s.fees.worldRate / 100 },
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const st = s.storage;

  return (
    <>
      <h2>설정</h2>

      <h3>일러스트 스토리지</h3>
      <div className="panel">
        <label>업로드 대상</label>
        <select
          value={st.type}
          onChange={(e) => setS({ ...s, storage: { ...st, type: e.target.value as "s3" | "ftp" } })}
        >
          <option value="s3">S3 (또는 S3 호환)</option>
          <option value="ftp">FTP</option>
        </select>

        {st.type === "s3" ? (
          <>
            <div className="row">
              <div>
                <label>Region</label>
                <input value={st.s3.region}
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, region: e.target.value } } })} />
              </div>
              <div>
                <label>Bucket</label>
                <input value={st.s3.bucket}
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, bucket: e.target.value } } })} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Access Key ID</label>
                <input value={st.s3.accessKeyId}
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, accessKeyId: e.target.value } } })} />
              </div>
              <div>
                <label>Secret Access Key</label>
                <input type="password" value={st.s3.secretAccessKey}
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, secretAccessKey: e.target.value } } })} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Endpoint (MinIO 등 S3 호환 스토리지만 입력)</label>
                <input value={st.s3.endpoint} placeholder="https://minio.example.com"
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, endpoint: e.target.value } } })} />
              </div>
              <div>
                <label>공개 URL prefix (CDN 사용 시)</label>
                <input value={st.s3.publicBaseUrl} placeholder="https://cdn.example.com"
                  onChange={(e) => setS({ ...s, storage: { ...st, s3: { ...st.s3, publicBaseUrl: e.target.value } } })} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <div>
                <label>Host</label>
                <input value={st.ftp.host}
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, host: e.target.value } } })} />
              </div>
              <div>
                <label>Port</label>
                <input type="number" value={st.ftp.port}
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, port: Number(e.target.value) } } })} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>User</label>
                <input value={st.ftp.user}
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, user: e.target.value } } })} />
              </div>
              <div>
                <label>Password</label>
                <input type="password" value={st.ftp.password}
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, password: e.target.value } } })} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>업로드 기준 경로</label>
                <input value={st.ftp.basePath} placeholder="/htdocs/uploads"
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, basePath: e.target.value } } })} />
              </div>
              <div>
                <label>공개 URL prefix (필수)</label>
                <input value={st.ftp.publicBaseUrl} placeholder="https://cdn.example.com/uploads"
                  onChange={(e) => setS({ ...s, storage: { ...st, ftp: { ...st.ftp, publicBaseUrl: e.target.value } } })} />
              </div>
            </div>
          </>
        )}
      </div>

      <h3>LLM</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>모델</label>
            <input value={s.llm.model}
              onChange={(e) => setS({ ...s, llm: { ...s.llm, model: e.target.value } })} />
          </div>
          <div>
            <label>최대 응답 토큰</label>
            <input type="number" value={s.llm.maxTokens}
              onChange={(e) => setS({ ...s, llm: { ...s.llm, maxTokens: Number(e.target.value) } })} />
          </div>
          <div>
            <label>컨텍스트 대화 수</label>
            <input type="number" value={s.llm.historyLimit}
              onChange={(e) => setS({ ...s, llm: { ...s.llm, historyLimit: Number(e.target.value) } })} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          API 키는 보안상 DB 가 아닌 서버 환경변수(ANTHROPIC_API_KEY)로 설정합니다.
        </p>
      </div>

      <h3>이미지 생성 (일러스트 AI)</h3>
      <div className="panel">
        <label>
          <input type="checkbox" checked={s.image_gen.enabled} style={{ width: "auto", marginRight: 6 }}
            onChange={(e) => setS({ ...s, image_gen: { ...s.image_gen, enabled: e.target.checked } })} />
          사용 (OpenAI 호환 images API)
        </label>
        <div className="row">
          <div>
            <label>Base URL</label>
            <input value={s.image_gen.baseUrl} placeholder="https://api.openai.com/v1"
              onChange={(e) => setS({ ...s, image_gen: { ...s.image_gen, baseUrl: e.target.value } })} />
          </div>
          <div>
            <label>API Key (저장된 키는 마스킹 표시 — 그대로 두면 유지)</label>
            <input type="password" value={s.image_gen.apiKey} autoComplete="new-password"
              onChange={(e) => setS({ ...s, image_gen: { ...s.image_gen, apiKey: e.target.value } })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>모델</label>
            <input value={s.image_gen.model}
              onChange={(e) => setS({ ...s, image_gen: { ...s.image_gen, model: e.target.value } })} />
          </div>
          <div>
            <label>크기</label>
            <select value={s.image_gen.size}
              onChange={(e) => setS({ ...s, image_gen: { ...s.image_gen, size: e.target.value } })}>
              <option value="1024x1536">1024x1536 (세로)</option>
              <option value="1024x1024">1024x1024 (정사각)</option>
              <option value="1536x1024">1536x1024 (가로)</option>
            </select>
          </div>
        </div>
      </div>

      <h3>수수료 / 가격</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>제작자 수수료율 (% — 채팅 비용 중 캐릭터 제작자 몫)</label>
            <input type="number" min={0} max={100} value={s.fees.creatorRate}
              onChange={(e) => setS({ ...s, fees: { ...s.fees, creatorRate: Number(e.target.value) } })} />
          </div>
          <div>
            <label>세계관 소유자 분배율 (% — 제작자 몫 중 세계관 소유자 몫)</label>
            <input type="number" min={0} max={100} value={s.fees.worldRate}
              onChange={(e) => setS({ ...s, fees: { ...s.fees, worldRate: Number(e.target.value) } })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>AI 보조 1회 비용(코인)</label>
            <input type="number" min={0} value={s.pricing.aiAssistCost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, aiAssistCost: Number(e.target.value) } })} />
          </div>
          <div>
            <label>일러스트 생성 1회 비용(코인)</label>
            <input type="number" min={0} value={s.pricing.illustGenCost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, illustGenCost: Number(e.target.value) } })} />
          </div>
        </div>
      </div>

      <button onClick={save}>{saved ? "저장됨 ✓" : "전체 저장"}</button>
    </>
  );
}
