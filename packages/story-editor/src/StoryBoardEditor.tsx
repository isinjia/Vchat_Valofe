"use client";

/**
 * 스토리보드 에디터 — 스튜디오(web)와 어드민이 공유하는 노드 기반 편집기.
 * 저장/공개/AI 생성은 전부 호스트가 api 콜백으로 구현한다 (앱별 인증/과금 차이 흡수).
 *
 * 보드 규칙 (core/story.ts 와 동일):
 * - 출력 포트(다음점) 하나는 연결 1개만. 이전점은 여러 연결을 받을 수 있다.
 * - 연결은 다음점→이전점 어느 쪽에서 시작해도 된다 (드래그 또는 클릭-클릭).
 * - 임시저장은 미완성 허용, 공개는 서버 검증(모든 경로가 끝까지 + 스토리 카드 ≥1).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  StoryBoard,
  StoryBranchNode,
  StoryBranchRule,
  StoryBranchTerm,
  StoryCardNode,
  StoryChoiceNode,
  StoryNode,
  StoryVarOp,
} from "@vchatbot/core";
import "./story-editor.css";

/* ---------- 호스트 연동 ---------- */

export interface StoryEditorApi {
  /** 임시저장 */
  saveDraft(title: string, board: StoryBoard, titleImageUrl: string | null): Promise<{ ok: boolean; error?: string }>;
  /** 공개 (호스트가 draft 저장 후 공개 API 호출). errors 가 있으면 공개 실패 사유 목록 */
  publish(title: string, board: StoryBoard, titleImageUrl: string | null): Promise<{ ok: boolean; errors?: string[] }>;
  /** 비공개 전환 */
  unpublish?(): Promise<{ ok: boolean }>;
  /** 스토리 카드 텍스트 AI 생성 (서버가 앞 연결 스토리/선택지 → 없으면 캐릭터 프로필로 컨텍스트 구성) */
  generateText?(nodeId: string, board: StoryBoard): Promise<{ text?: string; error?: string }>;
  /** 이미지 업로드 → 공개 URL */
  uploadImage?(file: File): Promise<{ url?: string; error?: string }>;
  /** 이미지 AI 생성 → 공개 URL */
  generateImage?(nodeId: string, board: StoryBoard, prompt: string): Promise<{ url?: string; error?: string }>;
}

export interface StoryBoardEditorProps {
  initialTitle: string;
  initialBoard: StoryBoard;
  initialStatus: "draft" | "published";
  /** 스토리 타이틀 이미지 (목록 카드 상단에 표시) */
  initialTitleImage?: string | null;
  api: StoryEditorApi;
  /** AI 버튼 옆 비용 표기 (예: " (-50코인)") — 어드민은 생략 */
  genTextCostLabel?: string;
  genImageCostLabel?: string;
  /** 목록으로 돌아가기 링크 */
  backHref?: string;
  /** 상단바에 표시할 맥락 (예: "세계관 / 캐릭터") */
  subtitle?: string;
}

/* ---------- 내부 유틸 ---------- */

type Pt = { x: number; y: number };
type Pending = { kind: "out"; nodeId: string; port: string } | { kind: "in"; nodeId: string };

const nid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const oid = () => `o${Math.random().toString(36).slice(2, 9)}`;

function outPortDir(node: StoryNode, port: string): "down" | "right" {
  if (node.type === "choice") return "right";
  if (node.type === "branch") return port === "else" ? "down" : "right";
  return "down";
}

function edgePath(a: Pt, dir: "down" | "right", b: Pt): string {
  const c1 = dir === "down" ? { x: a.x, y: a.y + 60 } : { x: a.x + 80, y: a.y };
  const c2 = { x: b.x, y: b.y - 60 };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

const NODE_TYPE_LABEL: Record<StoryNode["type"], string> = {
  start: "스토리 시작",
  end: "스토리 끝",
  story: "스토리",
  choice: "선택지",
  branch: "분기점",
};

/* ---------- 변수 조정 편집 (스토리 카드 / 선택지 옵션 공용) ---------- */

function VarOpsEditor({
  ops,
  vars,
  onChange,
}: {
  ops: StoryVarOp[];
  vars: string[];
  onChange: (ops: StoryVarOp[]) => void;
}) {
  if (vars.length === 0) return <p className="sbe-muted">변수를 먼저 추가하세요 (상단 &quot;변수 +&quot;)</p>;
  return (
    <div className="sbe-varops">
      {ops.map((op, i) => (
        <div className="sbe-varop-row" key={i}>
          <select
            className="sbe-varop-var"
            value={op.var}
            onChange={(e) => onChange(ops.map((o, j) => (j === i ? { ...o, var: e.target.value } : o)))}
          >
            {!vars.includes(op.var) && <option value={op.var}>{op.var || "?"}</option>}
            {vars.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <select
            className="sbe-varop-op"
            value={op.op}
            onChange={(e) => onChange(ops.map((o, j) => (j === i ? { ...o, op: e.target.value as "add" | "set" } : o)))}
          >
            <option value="add">+=</option>
            <option value="set">=</option>
          </select>
          <input
            type="number"
            value={op.value}
            onChange={(e) => onChange(ops.map((o, j) => (j === i ? { ...o, value: Number(e.target.value) || 0 } : o)))}
          />
          <button type="button" className="sbe-x" onClick={() => onChange(ops.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button
        type="button"
        className="sbe-mini"
        onClick={() => onChange([...ops, { var: vars[0], op: "add", value: 1 }])}
      >
        + 변수 조정
      </button>
    </div>
  );
}

/* ---------- 분기 조건 항 (비교 방식: 이상/이하/같음/범위 — 저장은 min/max 로 통일) ---------- */

type TermMode = "gte" | "lte" | "eq" | "range";
const deriveMode = (t: StoryBranchTerm): TermMode =>
  t.min != null && t.max != null ? (t.min === t.max ? "eq" : "range") : t.max != null ? "lte" : "gte";

function BranchTermRow({
  term,
  logic,
  showTag,
  vars,
  onTerm,
  onToggleLogic,
  onRemove,
}: {
  term: StoryBranchTerm;
  logic: "and" | "or";
  /** 둘째 항부터 AND/OR 토글 태그 표시 */
  showTag: boolean;
  vars: string[];
  onTerm: (patch: Partial<StoryBranchTerm>) => void;
  onToggleLogic: () => void;
  /** null 이면 삭제 불가(항 1개) */
  onRemove: (() => void) | null;
}) {
  const [mode, setMode] = useState<TermMode>(() => deriveMode(term));
  const num = (v: string) => (v === "" ? null : Number(v));
  const single = term.min ?? term.max ?? null;
  return (
    <div className="sbe-opt-row">
      {showTag && (
        <button type="button" className="sbe-logic-tag" title="클릭하면 AND/OR 전환" onClick={onToggleLogic}>
          {logic === "or" ? "OR" : "AND"}
        </button>
      )}
      <select value={term.var} onChange={(e) => onTerm({ var: e.target.value })}>
        {!vars.includes(term.var) && <option value={term.var}>{term.var || "변수?"}</option>}
        {vars.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        className="sbe-term-mode"
        value={mode}
        onChange={(e) => {
          const m = e.target.value as TermMode;
          setMode(m);
          const v = term.min ?? term.max ?? 0;
          if (m === "gte") onTerm({ min: v, max: null });
          else if (m === "lte") onTerm({ min: null, max: v });
          else if (m === "eq") onTerm({ min: v, max: v });
          else onTerm({ min: term.min, max: term.max }); // 범위: 값 유지, 입력칸만 2개로
        }}
      >
        <option value="gte">이상</option>
        <option value="lte">이하</option>
        <option value="eq">같음</option>
        <option value="range">범위</option>
      </select>
      {mode === "range" ? (
        <>
          <input
            type="number"
            className="sbe-range"
            placeholder="최소"
            value={term.min ?? ""}
            onChange={(e) => onTerm({ min: num(e.target.value) })}
          />
          <span className="sbe-muted">~</span>
          <input
            type="number"
            className="sbe-range"
            placeholder="최대"
            value={term.max ?? ""}
            onChange={(e) => onTerm({ max: num(e.target.value) })}
          />
        </>
      ) : (
        <input
          type="number"
          className="sbe-range"
          placeholder="값"
          value={single ?? ""}
          onChange={(e) => {
            const v = num(e.target.value);
            if (mode === "gte") onTerm({ min: v, max: null });
            else if (mode === "lte") onTerm({ min: null, max: v });
            else onTerm({ min: v, max: v });
          }}
        />
      )}
      {onRemove && (
        <button type="button" className="sbe-x" title="항 삭제" onClick={onRemove}>✕</button>
      )}
    </div>
  );
}

/* ---------- 변수 이름 (blur 때 커밋 — 타이핑 중간 상태로 참조가 깨지지 않게) ---------- */

function VarNameInput({ name, onCommit }: { name: string; onCommit: (next: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return (
    <input
      className="sbe-var-name"
      value={v}
      placeholder="변수명"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v.trim().slice(0, 32);
        if (next && next !== name) onCommit(next);
        else setV(name);
      }}
    />
  );
}

/* ---------- 메인 ---------- */

export function StoryBoardEditor({
  initialTitle,
  initialBoard,
  initialStatus,
  initialTitleImage = null,
  api,
  genTextCostLabel = "",
  genImageCostLabel = "",
  backHref,
  subtitle,
}: StoryBoardEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [titleImage, setTitleImage] = useState<string | null>(initialTitleImage);
  const [board, setBoardRaw] = useState<StoryBoard>(initialBoard);
  const [status, setStatus] = useState<"draft" | "published">(initialStatus);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // "save" | "publish" | `gen:${nodeId}` | `img:${nodeId}`
  const [flash, setFlash] = useState("");
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null); // `${from}:${fromPort}`
  const [imgPromptFor, setImgPromptFor] = useState<string | null>(null);
  const [imgPrompt, setImgPrompt] = useState("");

  const setBoard = useCallback((fn: (b: StoryBoard) => StoryBoard) => {
    setBoardRaw((b) => fn(b));
    setDirty(true);
  }, []);

  /* 저장 전 이탈 경고 */
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  /* ---------- 포트 위치 측정 ---------- */
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const portEls = useRef(new Map<string, HTMLElement>());
  const [portPos, setPortPos] = useState<Map<string, Pt>>(new Map());

  const registerPort = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      if (el) portEls.current.set(key, el);
      else portEls.current.delete(key);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();
    const next = new Map<string, Pt>();
    let changed = false;
    for (const [key, el] of portEls.current) {
      const r = el.getBoundingClientRect();
      // 줌(멀리보기) 상태에서는 화면 좌표를 캔버스 좌표로 환산
      const p = {
        x: (r.left + r.width / 2 - cRect.left) / viewScale,
        y: (r.top + r.height / 2 - cRect.top) / viewScale,
      };
      next.set(key, p);
      const prev = portPos.get(key);
      if (!prev || Math.abs(prev.x - p.x) > 0.5 || Math.abs(prev.y - p.y) > 0.5) changed = true;
    }
    if (next.size !== portPos.size) changed = true;
    if (changed) setPortPos(next);
  });

  /* ---------- 노드/보드 조작 ---------- */
  const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
  const varNames = board.vars.map((v) => v.name);
  // 캔버스 크기: 가장 먼 카드까지 포함해 자란다 — 멀리 떨어진 카드의 연결선도 잘리지 않는다
  const canvasW = Math.max(2000, ...board.nodes.map((n) => n.x + 360)) + 400;
  const canvasH = Math.max(1200, ...board.nodes.map((n) => n.y + 480)) + 400;

  const updateNode = useCallback(
    (id: string, patch: (n: StoryNode) => StoryNode) =>
      setBoard((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === id ? patch(n) : n)) })),
    [setBoard]
  );

  const spawnPos = useRef(0);
  const addNode = (node: StoryNode) => {
    const scroller = canvasRef.current?.parentElement;
    const baseX = (scroller?.scrollLeft ?? 0) + 340;
    const baseY = (scroller?.scrollTop ?? 0) + 60;
    spawnPos.current = (spawnPos.current + 1) % 8;
    setBoard((b) => ({
      ...b,
      nodes: [...b.nodes, { ...node, x: baseX + spawnPos.current * 28, y: baseY + spawnPos.current * 28 }],
    }));
  };

  const removeNode = (id: string) => {
    setBoard((b) => ({
      ...b,
      nodes: b.nodes.filter((n) => n.id !== id),
      edges: b.edges.filter((e) => e.from !== id && e.to !== id),
    }));
  };

  const addEdge = (from: string, fromPort: string, to: string) => {
    if (from === to) return;
    const dst = nodeById.get(to);
    if (!dst || dst.type === "start") return;
    setBoard((b) => ({
      ...b,
      edges: [...b.edges.filter((e) => !(e.from === from && e.fromPort === fromPort)), { from, fromPort, to }],
    }));
  };

  const removeEdgeByKey = (key: string) => {
    setBoard((b) => ({ ...b, edges: b.edges.filter((e) => `${e.from}:${e.fromPort}` !== key) }));
    setSelectedEdge(null);
  };

  /* 포트에서 연결 시작/완료 */
  const portDown = (p: Pending) => {
    setSelectedEdge(null);
    setPending((cur) => {
      if (!cur) return p;
      // 반대 종류 포트를 눌렀으면 연결 완료
      if (cur.kind === "out" && p.kind === "in") {
        addEdge(cur.nodeId, cur.port, p.nodeId);
        return null;
      }
      if (cur.kind === "in" && p.kind === "out") {
        addEdge(p.nodeId, p.port, cur.nodeId);
        return null;
      }
      return p; // 같은 종류면 시작점 교체
    });
  };
  const portUp = (p: Pending) => {
    setPending((cur) => {
      if (!cur) return null;
      // 드래그로 다른 포트 위에서 놓은 경우 연결, 같은 포트 위에서 놓았으면 클릭-클릭 모드로 유지
      if (cur.kind === "out" && p.kind === "in") {
        addEdge(cur.nodeId, cur.port, p.nodeId);
        return null;
      }
      if (cur.kind === "in" && p.kind === "out") {
        addEdge(p.nodeId, p.port, cur.nodeId);
        return null;
      }
      return cur;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending(null);
        setSelectedEdge(null);
        setImgPromptFor(null);
        setZoomNode(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        removeEdgeByKey(selectedEdge);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge]);

  /* ---------- 캔버스 팬 (휠버튼 드래그) ---------- */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const scrollerDown = (e: React.PointerEvent) => {
    if (e.button !== 1) return; // 휠(가운데) 버튼만
    const sc = scrollerRef.current;
    if (!sc) return;
    e.preventDefault();
    panRef.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const scrollerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    const sc = scrollerRef.current;
    if (!p || !sc) return;
    sc.scrollLeft = p.sl - (e.clientX - p.x);
    sc.scrollTop = p.st - (e.clientY - p.y);
  };
  const scrollerUp = () => {
    panRef.current = null;
    setPanning(false);
  };

  /* ---------- 화면 맞춤 높이 (창 크기에 따라 에디터가 꽉 차게) ---------- */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootH, setRootH] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const el = rootRef.current;
      if (!el) return;
      setRootH(Math.max(420, window.innerHeight - el.getBoundingClientRect().top - 14));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /* ---------- 멀리보기 (줌아웃) ---------- */
  const [overview, setOverview] = useState(false);
  const [viewScale, setViewScale] = useState(1);
  const [zoomNode, setZoomNode] = useState<string | null>(null); // 돋보기 팝업 대상
  const boardRefLatest = useRef(board);
  boardRefLatest.current = board;

  const fitOverview = useCallback(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    let w = 1200;
    let h = 700;
    for (const n of boardRefLatest.current.nodes) {
      w = Math.max(w, n.x + 360);
      h = Math.max(h, n.y + 480);
    }
    setViewScale(Math.max(0.12, Math.min(1, (sc.clientWidth - 20) / w, (sc.clientHeight - 20) / h)));
    sc.scrollLeft = 0;
    sc.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!overview) {
      setViewScale(1);
      return;
    }
    fitOverview();
    window.addEventListener("resize", fitOverview);
    return () => window.removeEventListener("resize", fitOverview);
  }, [overview, fitOverview]);

  /* ---------- 카드 드래그 ---------- */
  const dragRef = useRef<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const headDown = (e: React.PointerEvent, node: StoryNode) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: node.id, startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y };
  };
  const headMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Math.max(0, d.nodeX + (e.clientX - d.startX) / viewScale);
    const y = Math.max(0, d.nodeY + (e.clientY - d.startY) / viewScale);
    updateNode(d.id, (n) => ({ ...n, x: Math.round(x), y: Math.round(y) }));
  };
  const headUp = () => {
    dragRef.current = null;
  };

  /* ---------- 변수 ---------- */
  const addVar = () => {
    let i = board.vars.length + 1;
    let name = `변수${i}`;
    while (varNames.includes(name)) name = `변수${++i}`;
    setBoard((b) => ({ ...b, vars: [...b.vars, { name, initial: 0 }] }));
  };
  const renameVar = (oldName: string, newName: string) => {
    if (varNames.includes(newName)) return;
    const mapOps = (ops: StoryVarOp[]) => ops.map((o) => (o.var === oldName ? { ...o, var: newName } : o));
    setBoard((b) => ({
      vars: b.vars.map((v) => (v.name === oldName ? { ...v, name: newName } : v)),
      nodes: b.nodes.map((n) => {
        if (n.type === "story") return { ...n, varOps: mapOps(n.varOps) };
        if (n.type === "choice") return { ...n, options: n.options.map((o) => ({ ...o, varOps: mapOps(o.varOps) })) };
        if (n.type === "branch")
          return {
            ...n,
            rules: n.rules.map((r) => ({
              ...r,
              terms: r.terms.map((t) => (t.var === oldName ? { ...t, var: newName } : t)),
            })),
          };
        return n;
      }),
      edges: b.edges,
    }));
  };
  const removeVar = (name: string) => {
    const dropOps = (ops: StoryVarOp[]) => ops.filter((o) => o.var !== name);
    setBoard((b) => ({
      vars: b.vars.filter((v) => v.name !== name),
      nodes: b.nodes.map((n) => {
        if (n.type === "story") return { ...n, varOps: dropOps(n.varOps) };
        if (n.type === "choice") return { ...n, options: n.options.map((o) => ({ ...o, varOps: dropOps(o.varOps) })) };
        if (n.type === "branch")
          return {
            ...n,
            rules: n.rules.map((r) => ({
              ...r,
              terms: r.terms.map((t) => (t.var === name ? { ...t, var: "" } : t)),
            })),
          };
        return n;
      }),
      edges: b.edges,
    }));
  };

  /* ---------- 저장/공개 ---------- */
  const flashMsg = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(""), 2000);
  };

  const doSave = async () => {
    setBusy("save");
    setPublishErrors([]);
    try {
      const r = await api.saveDraft(title, board, titleImage);
      if (r.ok) {
        setDirty(false);
        flashMsg("임시저장됨 ✓");
      } else flashMsg(r.error ?? "저장 실패");
    } finally {
      setBusy(null);
    }
  };

  const doPublish = async () => {
    setBusy("publish");
    setPublishErrors([]);
    try {
      const r = await api.publish(title, board, titleImage);
      if (r.ok) {
        setDirty(false);
        setStatus("published");
        flashMsg("공개됨 ✓");
      } else {
        setPublishErrors(r.errors ?? ["공개 실패"]);
      }
    } finally {
      setBusy(null);
    }
  };

  const doUnpublish = async () => {
    if (!api.unpublish) return;
    setBusy("publish");
    try {
      const r = await api.unpublish();
      if (r.ok) {
        setStatus("draft");
        flashMsg("비공개로 전환됨");
      }
    } finally {
      setBusy(null);
    }
  };

  /* ---------- AI / 이미지 ---------- */
  const genText = async (node: StoryCardNode) => {
    if (!api.generateText) return;
    setBusy(`gen:${node.id}`);
    try {
      const r = await api.generateText(node.id, board);
      if (r.text) updateNode(node.id, (n) => ({ ...(n as StoryCardNode), text: r.text! }));
      else if (r.error) flashMsg(r.error);
    } finally {
      setBusy(null);
    }
  };

  const uploadImg = async (node: StoryCardNode, file: File) => {
    if (!api.uploadImage) return;
    setBusy(`img:${node.id}`);
    try {
      const r = await api.uploadImage(file);
      if (r.url) updateNode(node.id, (n) => ({ ...(n as StoryCardNode), imageUrl: r.url! }));
      else if (r.error) flashMsg(r.error);
    } finally {
      setBusy(null);
    }
  };

  const genImg = async (node: StoryCardNode) => {
    if (!api.generateImage) return;
    setBusy(`img:${node.id}`);
    setImgPromptFor(null);
    try {
      const r = await api.generateImage(node.id, board, imgPrompt);
      if (r.url) updateNode(node.id, (n) => ({ ...(n as StoryCardNode), imageUrl: r.url! }));
      else if (r.error) flashMsg(r.error);
    } finally {
      setBusy(null);
    }
  };

  /* ---------- 포트 렌더 ---------- */
  const InPort = ({ nodeId }: { nodeId: string }) => (
    <div
      className={`sbe-port sbe-port-in${pending?.kind === "out" ? " sbe-port-hot" : ""}`}
      title="이전점"
      ref={registerPort(`in:${nodeId}`)}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // 휠버튼은 팬으로 통과
        e.stopPropagation();
        portDown({ kind: "in", nodeId });
      }}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        portUp({ kind: "in", nodeId });
      }}
    />
  );

  const OutPort = ({ nodeId, port, side }: { nodeId: string; port: string; side: "bottom" | "right" }) => {
    const connected = board.edges.some((e) => e.from === nodeId && e.fromPort === port);
    return (
      <div
        className={`sbe-port sbe-port-out sbe-port-${side}${connected ? " sbe-port-on" : ""}${pending?.kind === "in" ? " sbe-port-hot" : ""}`}
        title="다음점"
        ref={registerPort(`out:${nodeId}:${port}`)}
        onPointerDown={(e) => {
          if (e.button !== 0) return; // 휠버튼은 팬으로 통과
          e.stopPropagation();
          portDown({ kind: "out", nodeId, port });
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          portUp({ kind: "out", nodeId, port });
        }}
      />
    );
  };

  /* ---------- 캔버스 좌표 ---------- */
  const canvasPoint = (e: React.PointerEvent): Pt | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / viewScale, y: (e.clientY - r.top) / viewScale };
  };

  /* ---------- 카드 내용 렌더 (캔버스 카드 + 멀리보기 팝업 공용) ---------- */
  const renderNodeBody = (node: StoryNode, withPorts: boolean) => {
    if (node.type === "story") {
      return (
        <div className="sbe-card-body">
          <input
            placeholder="타이틀 (채팅창 상단에 표시)"
            value={node.title}
            onChange={(e) => updateNode(node.id, (n) => ({ ...(n as StoryCardNode), title: e.target.value }))}
          />
          <textarea
            rows={4}
            placeholder="배경설정 (플레이 시 이 설정을 바탕으로 AI 가 대화 장면을 생성)"
            value={node.text}
            onChange={(e) => updateNode(node.id, (n) => ({ ...(n as StoryCardNode), text: e.target.value }))}
          />
          {api.generateText && (
            <button
              type="button"
              className="sbe-mini"
              title="앞뒤로 연결된 카드들의 배경설정·선택지를 반영해 이 카드의 배경설정을 생성"
              disabled={busy != null}
              onClick={() => genText(node)}
            >
              {busy === `gen:${node.id}` ? "생성 중..." : `배경설정 AI 생성${genTextCostLabel}`}
            </button>
          )}
          {node.imageUrl ? (
            <div className="sbe-img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={node.imageUrl} alt="" />
              <button
                type="button"
                className="sbe-x"
                title="이미지 제거"
                onClick={() => updateNode(node.id, (n) => ({ ...(n as StoryCardNode), imageUrl: null }))}
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="sbe-img-btns">
              {api.uploadImage && (
                <label className="sbe-mini sbe-filebtn">
                  이미지 업로드
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) uploadImg(node, f);
                    }}
                  />
                </label>
              )}
              {api.generateImage && (
                <button
                  type="button"
                  className="sbe-mini"
                  disabled={busy != null}
                  onClick={() => {
                    setImgPromptFor(imgPromptFor === node.id ? null : node.id);
                    setImgPrompt(`${node.title}\n${node.text}`.trim().slice(0, 500));
                  }}
                >
                  {busy === `img:${node.id}` ? "생성 중..." : `이미지 AI 생성${genImageCostLabel}`}
                </button>
              )}
            </div>
          )}
          {imgPromptFor === node.id && (
            <div className="sbe-img-prompt">
              <textarea rows={3} value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="이미지 설명" />
              <button type="button" className="sbe-mini" disabled={busy != null} onClick={() => genImg(node)}>
                생성{genImageCostLabel}
              </button>
            </div>
          )}
          <details className="sbe-ops" open={node.varOps.length > 0}>
            <summary>진행 후 변수 조정 {node.varOps.length > 0 ? `(${node.varOps.length})` : ""}</summary>
            <VarOpsEditor
              ops={node.varOps}
              vars={varNames}
              onChange={(ops) => updateNode(node.id, (n) => ({ ...(n as StoryCardNode), varOps: ops }))}
            />
          </details>
        </div>
      );
    }
    if (node.type === "choice") {
      return (
        <div className="sbe-card-body">
          {node.options.map((opt, i) => (
            <div className="sbe-opt" key={opt.id}>
              <div className="sbe-opt-row">
                <input
                  placeholder={`선택지 ${i + 1}`}
                  value={opt.text}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...(n as StoryChoiceNode),
                      options: (n as StoryChoiceNode).options.map((o) =>
                        o.id === opt.id ? { ...o, text: e.target.value } : o
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="sbe-x"
                  title="선택지 삭제"
                  onClick={() =>
                    updateNode(node.id, (n) => ({
                      ...(n as StoryChoiceNode),
                      options: (n as StoryChoiceNode).options.filter((o) => o.id !== opt.id),
                    }))
                  }
                >
                  ✕
                </button>
                {withPorts && <OutPort nodeId={node.id} port={opt.id} side="right" />}
              </div>
              <details className="sbe-ops" open={opt.varOps.length > 0}>
                <summary>변수 조정 {opt.varOps.length > 0 ? `(${opt.varOps.length})` : ""}</summary>
                <VarOpsEditor
                  ops={opt.varOps}
                  vars={varNames}
                  onChange={(ops) =>
                    updateNode(node.id, (n) => ({
                      ...(n as StoryChoiceNode),
                      options: (n as StoryChoiceNode).options.map((o) =>
                        o.id === opt.id ? { ...o, varOps: ops } : o
                      ),
                    }))
                  }
                />
              </details>
            </div>
          ))}
          <button
            type="button"
            className="sbe-mini"
            onClick={() =>
              updateNode(node.id, (n) => ({
                ...(n as StoryChoiceNode),
                options: [...(n as StoryChoiceNode).options, { id: oid(), text: "", varOps: [] }],
              }))
            }
          >
            ＋ 선택지
          </button>
        </div>
      );
    }
    if (node.type === "branch") {
      return (
        <div className="sbe-card-body">
          {node.rules.map((rule, ri) => {
            const setRule = (patch: Partial<StoryBranchRule>) =>
              updateNode(node.id, (n) => ({
                ...(n as StoryBranchNode),
                rules: (n as StoryBranchNode).rules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)),
              }));
            return (
              <div className="sbe-rule" key={rule.id}>
                <div className="sbe-rule-head">
                  <span className="sbe-muted">조건 {ri + 1}</span>
                  {rule.terms.length > 1 && (
                    <select
                      className="sbe-rule-logic"
                      value={rule.logic}
                      onChange={(e) => setRule({ logic: e.target.value as "and" | "or" })}
                    >
                      <option value="and">모두 충족 (AND)</option>
                      <option value="or">하나라도 (OR)</option>
                    </select>
                  )}
                  <button
                    type="button"
                    className="sbe-x"
                    title="조건 삭제"
                    onClick={() =>
                      updateNode(node.id, (n) => ({
                        ...(n as StoryBranchNode),
                        rules: (n as StoryBranchNode).rules.filter((r) => r.id !== rule.id),
                      }))
                    }
                  >
                    ✕
                  </button>
                  {withPorts && <OutPort nodeId={node.id} port={rule.id} side="right" />}
                </div>
                {rule.terms.map((term, ti) => (
                  <BranchTermRow
                    key={ti}
                    term={term}
                    logic={rule.logic}
                    showTag={ti > 0}
                    vars={varNames}
                    onTerm={(patch) =>
                      setRule({ terms: rule.terms.map((t, j) => (j === ti ? { ...t, ...patch } : t)) })
                    }
                    onToggleLogic={() => setRule({ logic: rule.logic === "or" ? "and" : "or" })}
                    onRemove={
                      rule.terms.length > 1 ? () => setRule({ terms: rule.terms.filter((_, j) => j !== ti) }) : null
                    }
                  />
                ))}
                <button
                  type="button"
                  className="sbe-mini"
                  onClick={() => setRule({ terms: [...rule.terms, { var: varNames[0] ?? "", min: null, max: null }] })}
                >
                  ＋ AND/OR 항
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="sbe-mini"
            onClick={() =>
              updateNode(node.id, (n) => ({
                ...(n as StoryBranchNode),
                rules: [
                  ...(n as StoryBranchNode).rules,
                  { id: oid(), logic: "and", terms: [{ var: varNames[0] ?? "", min: null, max: null }] },
                ],
              }))
            }
          >
            ＋ 조건
          </button>
          <div className="sbe-else">조건 불일치 시 (그 외)</div>
        </div>
      );
    }
    return null;
  };

  /* ---------- 렌더 ---------- */
  const pendingStart =
    pending?.kind === "out" ? portPos.get(`out:${pending.nodeId}:${pending.port}`) : pending ? portPos.get(`in:${pending.nodeId}`) : null;

  return (
    <div className="sbe-root" ref={rootRef} style={rootH ? { height: rootH } : undefined}>
      <div className="sbe-topbar">
        {backHref && <a className="sbe-back" href={backHref}>← 목록</a>}
        {subtitle && <span className="sbe-subtitle" title={subtitle}>{subtitle}</span>}
        <input className="sbe-title" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="스토리 제목" />
        {api.uploadImage &&
          (titleImage ? (
            <span className="sbe-timg" title="스토리 타이틀 이미지">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={titleImage} alt="" />
              <button type="button" className="sbe-x" title="타이틀 이미지 제거" onClick={() => { setTitleImage(null); setDirty(true); }}>✕</button>
            </span>
          ) : (
            <label className="sbe-btn sbe-filebtn" title="스토리 목록 카드에 표시될 타이틀 이미지">
              {busy === "timg" ? "업로드 중..." : "타이틀 이미지"}
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f || !api.uploadImage) return;
                  setBusy("timg");
                  try {
                    const r = await api.uploadImage(f);
                    if (r.url) {
                      setTitleImage(r.url);
                      setDirty(true);
                    } else if (r.error) flashMsg(r.error);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </label>
          ))}
        <span className={`sbe-badge ${status === "published" ? "sbe-badge-pub" : ""}`}>
          {status === "published" ? "공개됨" : "임시저장"}
        </span>
        {dirty && <span className="sbe-dirty">●</span>}
        <div className="sbe-topbar-spacer" />
        <button type="button" className="sbe-btn" onClick={addVar}>변수 +</button>
        <button type="button" className="sbe-btn" onClick={() => addNode({ id: nid(), type: "story", x: 0, y: 0, title: "", text: "", imageUrl: null, varOps: [] })}>
          스토리카드 +
        </button>
        <button type="button" className="sbe-btn" onClick={() => addNode({ id: nid(), type: "choice", x: 0, y: 0, options: [{ id: oid(), text: "", varOps: [] }] })}>
          선택지 +
        </button>
        <button type="button" className="sbe-btn" onClick={() => addNode({ id: nid(), type: "branch", x: 0, y: 0, rules: [{ id: oid(), logic: "and", terms: [{ var: varNames[0] ?? "", min: null, max: null }] }] })}>
          분기점 +
        </button>
        <button
          type="button"
          className={`sbe-btn${overview ? " sbe-btn-on" : ""}`}
          title="보드 전체가 보이게 줌아웃 (카드의 🔍 로 내용 편집)"
          onClick={() => setOverview((o) => !o)}
        >
          {overview ? "편집 보기" : "멀리보기"}
        </button>
        <span className="sbe-sep" />
        <button type="button" className="sbe-btn" disabled={busy != null} onClick={doSave}>
          {busy === "save" ? "저장 중..." : "임시저장"}
        </button>
        <button type="button" className="sbe-btn sbe-btn-primary" disabled={busy != null} onClick={doPublish}>
          {busy === "publish" ? "처리 중..." : status === "published" ? "변경사항 공개" : "공개"}
        </button>
        {status === "published" && api.unpublish && (
          <button type="button" className="sbe-btn" disabled={busy != null} onClick={doUnpublish}>비공개 전환</button>
        )}
        {flash && <span className="sbe-flash">{flash}</span>}
      </div>

      {board.vars.length > 0 && (
        <div className="sbe-vars">
          <span className="sbe-vars-label">변수 (32비트 정수)</span>
          {board.vars.map((v) => (
            <span className="sbe-var" key={v.name}>
              <VarNameInput name={v.name} onCommit={(next) => renameVar(v.name, next)} />
              <span className="sbe-muted">기본</span>
              <input
                type="number"
                className="sbe-var-init"
                value={v.initial}
                onChange={(e) =>
                  setBoard((b) => ({
                    ...b,
                    vars: b.vars.map((x) => (x.name === v.name ? { ...x, initial: Number(e.target.value) || 0 } : x)),
                  }))
                }
              />
              <button type="button" className="sbe-x" title="변수 삭제" onClick={() => removeVar(v.name)}>✕</button>
            </span>
          ))}
        </div>
      )}

      {publishErrors.length > 0 && (
        <div className="sbe-errors">
          <strong>공개할 수 없습니다:</strong>
          <ul>
            {publishErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <button type="button" className="sbe-x" onClick={() => setPublishErrors([])}>✕</button>
        </div>
      )}

      <div
        className={`sbe-scroller${panning ? " sbe-panning" : ""}`}
        ref={scrollerRef}
        onPointerDown={scrollerDown}
        onPointerMove={scrollerMove}
        onPointerUp={scrollerUp}
        onPointerCancel={scrollerUp}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault(); // 브라우저 휠클릭 자동 스크롤 방지
        }}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
      >
        <div className="sbe-zoom-wrap" style={{ width: canvasW * viewScale, height: canvasH * viewScale }}>
        <div
          className={`sbe-canvas${overview ? " sbe-ov" : ""}`}
          ref={canvasRef}
          style={{ width: canvasW, height: canvasH, transform: viewScale !== 1 ? `scale(${viewScale})` : undefined }}
          onPointerMove={(e) => {
            if (pending) setMouse(canvasPoint(e));
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (e.target === e.currentTarget) {
              setPending(null);
              setSelectedEdge(null);
            }
          }}
        >
          <svg className="sbe-edges">
            {board.edges.map((e) => {
              const key = `${e.from}:${e.fromPort}`;
              const a = portPos.get(`out:${e.from}:${e.fromPort}`);
              const b = portPos.get(`in:${e.to}`);
              const src = nodeById.get(e.from);
              if (!a || !b || !src) return null;
              const d = edgePath(a, outPortDir(src, e.fromPort), b);
              const sel = selectedEdge === key;
              return (
                <g key={key}>
                  <path className="sbe-edge-hit" d={d} onClick={() => setSelectedEdge(sel ? null : key)} />
                  <path className={`sbe-edge${sel ? " sbe-edge-sel" : ""}`} d={d} />
                  {sel && (
                    <g
                      className="sbe-edge-del"
                      transform={`translate(${(a.x + b.x) / 2}, ${(a.y + b.y) / 2})`}
                      onClick={() => removeEdgeByKey(key)}
                    >
                      <circle r="9" />
                      <text textAnchor="middle" dominantBaseline="central">✕</text>
                    </g>
                  )}
                </g>
              );
            })}
            {pending && pendingStart && mouse && (
              <path className="sbe-edge sbe-edge-pending" d={
                pending.kind === "out"
                  ? edgePath(pendingStart, outPortDir(nodeById.get(pending.nodeId)!, pending.port), mouse)
                  : edgePath(mouse, "down", pendingStart)
              } />
            )}
          </svg>

          {board.nodes.map((node) => (
            <div
              key={node.id}
              className={`sbe-card sbe-card-${node.type}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(e) => {
                if (e.button !== 1) e.stopPropagation(); // 휠버튼은 캔버스 팬으로 통과
              }}
            >
              {node.type !== "start" && <InPort nodeId={node.id} />}

              <div
                className="sbe-card-head"
                onPointerDown={(e) => headDown(e, node)}
                onPointerMove={headMove}
                onPointerUp={headUp}
              >
                <span>{NODE_TYPE_LABEL[node.type]}</span>
                {node.type !== "start" && node.type !== "end" && (
                  <button type="button" className="sbe-x" title="카드 삭제" onClick={() => removeNode(node.id)}>✕</button>
                )}
              </div>

              {renderNodeBody(node, true)}

              {(node.type === "start" || node.type === "story") && <OutPort nodeId={node.id} port="out" side="bottom" />}
              {node.type === "branch" && <OutPort nodeId={node.id} port="else" side="bottom" />}

              {overview && node.type !== "start" && node.type !== "end" && (
                <button
                  type="button"
                  className="sbe-ov-zoom"
                  style={{ transform: `translate(-50%, -50%) scale(${Math.min(4, 1 / viewScale)})` }}
                  title="내용 편집"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setZoomNode(node.id)}
                >
                  🔍
                </button>
              )}
            </div>
          ))}
        </div>
        </div>
      </div>

      {zoomNode && nodeById.get(zoomNode) && (
        <div className="sbe-modal-backdrop" onClick={() => setZoomNode(null)}>
          <div className="sbe-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sbe-modal-head">
              <strong>{NODE_TYPE_LABEL[nodeById.get(zoomNode)!.type]} 내용 편집</strong>
              <button type="button" className="sbe-x" onClick={() => setZoomNode(null)}>✕</button>
            </div>
            {renderNodeBody(nodeById.get(zoomNode)!, false)}
          </div>
        </div>
      )}

      <p className="sbe-help">
        다음점(아래/오른쪽 점)과 이전점(위쪽 점)을 드래그하거나 차례로 클릭해 연결합니다. 연결선 클릭 → ✕ 로 삭제.
        다음점 하나는 연결 1개만 가능하고, 이전점은 여러 연결을 받을 수 있습니다. ESC 로 연결 취소.
      </p>
    </div>
  );
}
