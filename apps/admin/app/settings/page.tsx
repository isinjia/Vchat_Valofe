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
  llm: {
    model: string; maxTokens: number; historyLimit: number;
    assistProviderId: number | null; fallbackProviderId: number | null;
  };
  scoring: { scoringProviderId: number | null; timeoutMs: number };
  /** 비율은 화면에서 % (0~100) 로 편집, 저장 시 0~1 */
  fees: { creatorRate: number; worldRate: number; giftRate: number };
  billing: { chargeUrl: string };
  pricing: {
    aiAssistCost: number;
    illustGenCost: number;
    videoGenCost: number;
    aiAssist: Record<string, { coinsPer1k: number; minCost: number }>;
    byok: { enabled: boolean; cost: number };
  };
  /** apiKey 는 서버가 마스킹해서 내려주며, 수정하지 않으면 그대로 전송(서버가 기존 값 유지) */
  image_gen: { enabled: boolean; baseUrl: string; apiKey: string; model: string; size: string };
  /** 호감도 구간별 반응 가이드 기본값 (캐릭터별 설정이 없을 때 사용) */
  affinity_prompts: Record<string, string>;
  /** VMsgCenter(VMessage 런처 메신저) 챗봇 연동. secret 은 마스킹 표시 — 그대로 두면 유지 */
  vmsg: {
    enabled: boolean;
    apiBase: string;
    /** 화면에서는 텍스트로 편집, 저장 시 서버가 쉼표/줄바꿈으로 분할 */
    allowedIpsText: string;
    bots: { botClientId: string; clientSecret: string; characterId: number; enabled: boolean }[];
  };
}

/** 호감도 구간 목록 (client 컴포넌트라 core 에서 import 하지 않고 하드코딩 — core/settings.AFFINITY_BANDS 와 일치) */
const AFFINITY_BAND_UI: [string, string][] = [
  ["hostile", "적대 (-100 ~ -60)"],
  ["cold", "냉담 (-59 ~ -20)"],
  ["neutral", "중립 (-19 ~ 19)"],
  ["friendly", "호감 (20 ~ 59)"],
  ["devoted", "애정 (60 ~ 100)"],
];

/** AI 보조 기능(kind) 목록 + 라벨 (client 컴포넌트라 core 에서 import 하지 않고 하드코딩) */
const AI_KINDS: [string, string][] = [
  ["world_description", "세계관 설명"],
  ["world_prompt", "세계관 공통 프롬프트"],
  ["profile", "캐릭터 프로필"],
  ["personality", "기본 성격"],
  ["speech_style", "말투"],
  ["scenario", "상황 설정"],
  ["greeting", "첫 인사말"],
  ["compact_prompt", "브라우저 AI 압축 (캐릭터 설정 요약)"],
];

const EMPTY: Settings = {
  storage: {
    type: "s3",
    s3: { region: "ap-northeast-2", bucket: "", accessKeyId: "", secretAccessKey: "", endpoint: "", publicBaseUrl: "" },
    ftp: { host: "", port: 21, user: "", password: "", basePath: "/", publicBaseUrl: "" },
  },
  llm: { model: "claude-opus-5-5", maxTokens: 4096, historyLimit: 30, assistProviderId: null, fallbackProviderId: null },
  scoring: { scoringProviderId: null, timeoutMs: 10000 },
  fees: { creatorRate: 30, worldRate: 20, giftRate: 30 },
  billing: { chargeUrl: "" },
  pricing: { aiAssistCost: 50, illustGenCost: 500, videoGenCost: 2000, aiAssist: {}, byok: { enabled: true, cost: 10 } },
  image_gen: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-image-1", size: "1024x1536" },
  affinity_prompts: {},
  vmsg: { enabled: false, apiBase: "", allowedIpsText: "", bots: [] },
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [providers, setProviders] = useState<{ id: number; name: string; model: string; is_active: number | boolean }[]>([]);

  const [chars, setChars] = useState<{ id: number; name: string; world_name: string }[]>([]);

  useEffect(() => {
    fetch("/api/llm")
      .then((r) => r.json())
      .then((d) => setProviders(Array.isArray(d) ? d : []))
      .catch(() => setProviders([]));
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => setChars(Array.isArray(d) ? d : []))
      .catch(() => setChars([]));
  }, []);

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
          scoring: {
            scoringProviderId: data.scoring?.scoringProviderId ?? null,
            timeoutMs: data.scoring?.timeoutMs ?? EMPTY.scoring.timeoutMs,
          },
          fees: {
            creatorRate: Math.round((data.fees?.creatorRate ?? 0.3) * 1000) / 10,
            worldRate: Math.round((data.fees?.worldRate ?? 0.2) * 1000) / 10,
            giftRate: Math.round((data.fees?.giftRate ?? 0.3) * 1000) / 10,
          },
          billing: { chargeUrl: data.billing?.chargeUrl ?? "" },
          pricing: (() => {
            const p = { ...EMPTY.pricing, ...(data.pricing ?? {}) };
            const aiAssist: Settings["pricing"]["aiAssist"] = {};
            for (const [k] of AI_KINDS) {
              aiAssist[k] = data.pricing?.aiAssist?.[k] ?? { coinsPer1k: 0, minCost: p.aiAssistCost };
            }
            return { ...p, aiAssist, byok: { ...EMPTY.pricing.byok, ...(data.pricing?.byok ?? {}) } };
          })(),
          image_gen: { ...EMPTY.image_gen, ...(data.image_gen ?? {}) },
          affinity_prompts: data.affinity_prompts ?? {},
          vmsg: {
            enabled: !!data.vmsg?.enabled,
            apiBase: data.vmsg?.apiBase ?? "",
            allowedIpsText: Array.isArray(data.vmsg?.allowedIps) ? data.vmsg.allowedIps.join("\n") : "",
            bots: Array.isArray(data.vmsg?.bots) ? data.vmsg.bots : [],
          },
        });
      });
  }, []);

  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s,
        fees: { creatorRate: s.fees.creatorRate / 100, worldRate: s.fees.worldRate / 100, giftRate: s.fees.giftRate / 100 },
        vmsg: {
          enabled: s.vmsg.enabled,
          apiBase: s.vmsg.apiBase,
          allowedIps: s.vmsg.allowedIpsText,
          bots: s.vmsg.bots,
        },
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
        <div className="row">
          <div>
            <label>보조용 LLM</label>
            <select value={s.llm.assistProviderId ?? ""}
              onChange={(e) => setS({ ...s, llm: { ...s.llm, assistProviderId: e.target.value ? Number(e.target.value) : null } })}>
              <option value="">기본 (설정 모델 직접 호출)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.model}){p.is_active ? "" : " (OFF)"}</option>
              ))}
            </select>
            <p className="muted">스튜디오 AI 생성, 캐릭터 생성 보조에 사용. 게임데이터 분석은 Claude 고정</p>
          </div>
          <div>
            <label>폴백 LLM</label>
            <select value={s.llm.fallbackProviderId ?? ""}
              onChange={(e) => setS({ ...s, llm: { ...s.llm, fallbackProviderId: e.target.value ? Number(e.target.value) : null } })}>
              <option value="">기본 (설정 모델 직접 호출)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.model}){p.is_active ? "" : " (OFF)"}</option>
              ))}
            </select>
            <p className="muted">등급 할당이 없거나 모든 계정이 월 한도 소진일 때 사용</p>
          </div>
        </div>
        <div className="row">
          <div>
            <label>채점용 LLM</label>
            <select value={s.scoring.scoringProviderId ?? ""}
              onChange={(e) => setS({ ...s, scoring: { ...s.scoring, scoringProviderId: e.target.value ? Number(e.target.value) : null } })}>
              <option value="">기본 (Claude Haiku 직접 호출)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.model}){p.is_active ? "" : " (OFF)"}</option>
              ))}
            </select>
            <p className="muted">호감도 채점·게스트 난입 판단에 사용</p>
          </div>
          <div>
            <label>채점 타임아웃(ms)</label>
            <input type="number" min={1000} step={1000} value={s.scoring.timeoutMs}
              onChange={(e) => setS({ ...s, scoring: { ...s.scoring, timeoutMs: Number(e.target.value) } })} />
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

      <h3>호감도 반응 기본값</h3>
      <div className="panel">
        <div className="notice">
          호감도 구간별로 캐릭터가 유저를 대하는 태도의 기본 가이드입니다. 캐릭터별 설정(스튜디오)이 비어 있으면
          이 값이 채팅 프롬프트에 들어갑니다. 비워두고 저장하면 해당 구간은 내장 기본값으로 돌아갑니다.
        </div>
        {AFFINITY_BAND_UI.map(([key, label]) => (
          <div key={key}>
            <label>{label}</label>
            <textarea
              rows={2}
              value={s.affinity_prompts[key] ?? ""}
              onChange={(e) => setS({ ...s, affinity_prompts: { ...s.affinity_prompts, [key]: e.target.value } })}
            />
          </div>
        ))}
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
          <div>
            <label>아이템 판매 수수료율 (% — 선물 판매액 중 캐릭터 제작자 몫)</label>
            <input type="number" min={0} max={100} value={s.fees.giftRate}
              onChange={(e) => setS({ ...s, fees: { ...s.fees, giftRate: Number(e.target.value) } })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>코인 충전 페이지 링크 (비우면 충전 버튼은 준비 중 안내)</label>
            <input type="text" value={s.billing.chargeUrl} placeholder="https://..."
              onChange={(e) => setS({ ...s, billing: { chargeUrl: e.target.value } })} />
          </div>
        </div>
        <div className="row">
          <div>
            <label>기본 정액(코인) — 기능별 설정이 없을 때 AI 보조 1회 비용</label>
            <input type="number" min={0} value={s.pricing.aiAssistCost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, aiAssistCost: Number(e.target.value) } })} />
          </div>
          <div>
            <label>일러스트 생성 1회 비용(코인)</label>
            <input type="number" min={0} value={s.pricing.illustGenCost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, illustGenCost: Number(e.target.value) } })} />
          </div>
          <div>
            <label>영상 생성 1회 비용(코인)</label>
            <input type="number" min={0} value={s.pricing.videoGenCost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, videoGenCost: Number(e.target.value) } })} />
          </div>
        </div>

        <label style={{ marginTop: 12 }}>AI 보조 기능별 과금</label>
        <table>
          <thead>
            <tr>
              <th>기능</th>
              <th>1K토큰당 코인 (0=정액만)</th>
              <th>최소/정액 코인</th>
            </tr>
          </thead>
          <tbody>
            {AI_KINDS.map(([k, label]) => {
              const v = s.pricing.aiAssist[k] ?? { coinsPer1k: 0, minCost: s.pricing.aiAssistCost };
              const setK = (patch: Partial<typeof v>) =>
                setS({
                  ...s,
                  pricing: { ...s.pricing, aiAssist: { ...s.pricing.aiAssist, [k]: { ...v, ...patch } } },
                });
              return (
                <tr key={k}>
                  <td>{label}</td>
                  <td>
                    <input type="number" min={0} value={v.coinsPer1k}
                      onChange={(e) => setK({ coinsPer1k: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min={0} value={v.minCost}
                      onChange={(e) => setK({ minCost: Number(e.target.value) })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted">요율이 0 이면 최소/정액 코인만 차감, 0 초과면 max(최소, 올림((입력+출력 토큰)×요율/1000)) 코인을 차감합니다.</p>

        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <label>
              <input type="checkbox" checked={s.pricing.byok.enabled} style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setS({ ...s, pricing: { ...s.pricing, byok: { ...s.pricing.byok, enabled: e.target.checked } } })} />
              유저 본인 Claude 키 사용 허용
            </label>
          </div>
          <div>
            <label>BYOK 1회 정액(코인)</label>
            <input type="number" min={0} value={s.pricing.byok.cost}
              onChange={(e) => setS({ ...s, pricing: { ...s.pricing, byok: { ...s.pricing.byok, cost: Number(e.target.value) } } })} />
          </div>
        </div>
      </div>

      <h3>VMsgCenter 연동</h3>
      <div className="panel">
        <div className="notice">
          VMessage 런처 메신저의 챗봇과 연동합니다. 챗봇 1개 = 캐릭터 1명이며, Client ID/Secret 은 VMessage
          관리자 화면의 챗봇 메뉴에서 발급합니다 (Secret 은 발급 시 한 번만 표시). 발급 후 VMessage 쪽에
          콜백 주소로 <code>https://&lt;채팅서버&gt;/api/vmsg/callback</code> 을 등록하세요. 메신저 대화도
          웹 채팅과 동일하게 해당 유저의 코인에서 차감되며, 서비스에서 먼저 시작한 대화만 이어갈 수 있습니다.
        </div>
        <label>
          <input type="checkbox" checked={s.vmsg.enabled} style={{ width: "auto", marginRight: 6 }}
            onChange={(e) => setS({ ...s, vmsg: { ...s.vmsg, enabled: e.target.checked } })} />
          연동 사용
        </label>
        <div className="row">
          <div>
            <label>VMessage API 서버 주소</label>
            <input value={s.vmsg.apiBase} placeholder="https://vmsg.example.com:4000"
              onChange={(e) => setS({ ...s, vmsg: { ...s.vmsg, apiBase: e.target.value } })} />
            <p className="muted">답장 발송(/bot/v1/messages)에 사용하는 VMessage 메신저 웹 서버 주소</p>
          </div>
          <div>
            <label>콜백 허용 IP (쉼표/줄바꿈 구분)</label>
            <textarea rows={2} value={s.vmsg.allowedIpsText} placeholder="1.2.3.4&#10;5.6.7.8"
              onChange={(e) => setS({ ...s, vmsg: { ...s.vmsg, allowedIpsText: e.target.value } })} />
            <p className="muted">비우면 IP 제한 없음. 비워도 HMAC 서명 검증은 항상 수행됩니다 (프록시 뒤라면 X-Forwarded-For 기준)</p>
          </div>
        </div>

        <label style={{ marginTop: 12 }}>챗봇 목록</label>
        <table>
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Client Secret</th>
              <th>캐릭터</th>
              <th>사용</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.vmsg.bots.map((b, i) => {
              const setBot = (patch: Partial<typeof b>) =>
                setS({ ...s, vmsg: { ...s.vmsg, bots: s.vmsg.bots.map((x, j) => (j === i ? { ...x, ...patch } : x)) } });
              return (
                <tr key={i}>
                  <td>
                    <input value={b.botClientId} placeholder="vbot_..."
                      onChange={(e) => setBot({ botClientId: e.target.value })} />
                  </td>
                  <td>
                    <input type="password" value={b.clientSecret} autoComplete="new-password"
                      placeholder="저장됨 — 그대로 두면 유지"
                      onChange={(e) => setBot({ clientSecret: e.target.value })} />
                  </td>
                  <td>
                    <select value={b.characterId || ""}
                      onChange={(e) => setBot({ characterId: Number(e.target.value) || 0 })}>
                      <option value="">캐릭터 선택</option>
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>{c.world_name} / {c.name} (#{c.id})</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={b.enabled} style={{ width: "auto" }}
                      onChange={(e) => setBot({ enabled: e.target.checked })} />
                  </td>
                  <td>
                    <button type="button" className="danger"
                      onClick={() => setS({ ...s, vmsg: { ...s.vmsg, bots: s.vmsg.bots.filter((_, j) => j !== i) } })}>
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
            {s.vmsg.bots.length === 0 && (
              <tr><td colSpan={5} className="muted">등록된 챗봇이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button type="button"
            onClick={() => setS({
              ...s,
              vmsg: {
                ...s.vmsg,
                bots: [...s.vmsg.bots, { botClientId: "", clientSecret: "", characterId: 0, enabled: true }],
              },
            })}>
            + 챗봇 추가
          </button>
        </div>
      </div>

      <QuotaSection />

      <button onClick={save}>{saved ? "저장됨 ✓" : "전체 저장"}</button>
    </>
  );
}

interface QuotaTier {
  id: number;
  name: string;
  tier_rank: number;
  video_max_mb: number | null;
  effect_max_mb: number | null;
}

/** 업로드 쿼터: 전역 기본값 + 크리에이터 등급별 용량 제한 (별도 저장 버튼, /api/quotas) */
function QuotaSection() {
  const [uploads, setUploads] = useState({ videoMaxMb: 100, effectMaxMb: 2 });
  const [tiers, setTiers] = useState<QuotaTier[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/quotas")
      .then((r) => r.json())
      .then((d) => {
        if (d.uploads) setUploads(d.uploads);
        setTiers(Array.isArray(d.tiers) ? d.tiers : []);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    await fetch("/api/quotas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploads, tiers }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const setTier = (id: number, patch: Partial<QuotaTier>) =>
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <>
      <h3>업로드 쿼터</h3>
      <div className="panel">
        <div className="row">
          <div>
            <label>영상 업로드 기본 최대 (MB)</label>
            <input type="number" min={1} value={uploads.videoMaxMb}
              onChange={(e) => setUploads({ ...uploads, videoMaxMb: Number(e.target.value) })} />
          </div>
          <div>
            <label>프로필 효과 이미지 기본 최대 (MB)</label>
            <input type="number" min={1} value={uploads.effectMaxMb}
              onChange={(e) => setUploads({ ...uploads, effectMaxMb: Number(e.target.value) })} />
          </div>
        </div>
        <label style={{ marginTop: 12 }}>크리에이터 등급별 제한 (비우면 기본값 사용)</label>
        <table>
          <thead>
            <tr><th>등급</th><th>영상 최대 (MB)</th><th>효과 최대 (MB)</th></tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id}>
                <td>{t.name} <span className="muted">(순위 {t.tier_rank})</span></td>
                <td>
                  <input type="number" min={1} placeholder={`기본 ${uploads.videoMaxMb}`}
                    value={t.video_max_mb ?? ""}
                    onChange={(e) => setTier(t.id, { video_max_mb: e.target.value === "" ? null : Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" min={1} placeholder={`기본 ${uploads.effectMaxMb}`}
                    value={t.effect_max_mb ?? ""}
                    onChange={(e) => setTier(t.id, { effect_max_mb: e.target.value === "" ? null : Number(e.target.value) })} />
                </td>
              </tr>
            ))}
            {tiers.length === 0 && (
              <tr><td colSpan={3} className="muted">크리에이터 트랙 등급이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 12 }}>
          <button onClick={save}>{saved ? "저장됨 ✓" : "쿼터 저장"}</button>
        </div>
      </div>
    </>
  );
}
