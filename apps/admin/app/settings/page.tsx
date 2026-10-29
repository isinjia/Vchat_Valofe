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
}

const EMPTY: Settings = {
  storage: {
    type: "s3",
    s3: { region: "ap-northeast-2", bucket: "", accessKeyId: "", secretAccessKey: "", endpoint: "", publicBaseUrl: "" },
    ftp: { host: "", port: 21, user: "", password: "", basePath: "/", publicBaseUrl: "" },
  },
  llm: { model: "claude-opus-5-5", maxTokens: 4096, historyLimit: 30 },
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
        });
      });
  }, []);

  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
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

      <button onClick={save}>{saved ? "저장됨 ✓" : "전체 저장"}</button>
    </>
  );
}
