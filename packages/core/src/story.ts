import { query, execute } from "./mysql";

/**
 * 스토리 모드 — 캐릭터에 속한 분기형 시나리오(비주얼 노벨식).
 * 기존 대화/이벤트 채팅과 완전히 분리된 별도 모드다.
 *
 * 보드(그래프)는 JSON 하나로 저장한다:
 * - 노드: start / end / story(스토리 카드) / choice(선택지) / branch(분기점)
 * - 엣지: 노드의 출력 포트(다음점) → 노드(이전점). 출력 포트 하나는 엣지 1개만 가질 수 있고,
 *   이전점은 여러 출력에서 연결될 수 있다.
 * - 변수: 타입 없이 32비트 int 고정.
 * 임시저장(draft_json)은 미완성 연결을 허용하고, 공개(published_json)는 validateStoryBoard 를 통과해야 한다.
 */

/* ========== 보드 타입 ========== */

export interface StoryVar {
  name: string;
  /** 시작 시 기본값 (int32) */
  initial: number;
}

/** 변수 조정: add(+=) 또는 set(=) — value 는 int32 */
export interface StoryVarOp {
  var: string;
  op: "add" | "set";
  value: number;
}

interface StoryNodeBase {
  id: string;
  /** 보드 위 배치 좌표 (편집기 전용) */
  x: number;
  y: number;
}

export interface StoryStartNode extends StoryNodeBase {
  type: "start";
}
export interface StoryEndNode extends StoryNodeBase {
  type: "end";
}
export interface StoryCardNode extends StoryNodeBase {
  type: "story";
  /** 보드에서 보는 설명 + 플레이 중 채팅창 상단 타이틀 */
  title: string;
  /** 스토리 라인 텍스트 */
  text: string;
  /** 관련 이미지 (스토리지 공개 URL) */
  imageUrl?: string | null;
  /** 스토리 진행 후 변수 조정 */
  varOps: StoryVarOp[];
}
export interface StoryChoiceOption {
  id: string;
  text: string;
  varOps: StoryVarOp[];
}
export interface StoryChoiceNode extends StoryNodeBase {
  type: "choice";
  options: StoryChoiceOption[];
}
/** 분기 조건 항: 변수값이 [min, max] 범위(null 쪽은 무제한)인지 */
export interface StoryBranchTerm {
  var: string;
  min: number | null;
  max: number | null;
}
/** 분기 조건: 여러 항을 and(모두 충족)/or(하나라도 충족)로 묶는다. 충족 시 해당 다음점으로 */
export interface StoryBranchRule {
  id: string;
  logic: "and" | "or";
  terms: StoryBranchTerm[];
}
export interface StoryBranchNode extends StoryNodeBase {
  type: "branch";
  /** 위에서부터 순서대로 평가, 첫 일치 사용 */
  rules: StoryBranchRule[];
}

export type StoryNode = StoryStartNode | StoryEndNode | StoryCardNode | StoryChoiceNode | StoryBranchNode;

/**
 * 연결: from 노드의 fromPort(다음점) → to 노드(이전점).
 * fromPort: start/story = "out", choice = 옵션 id, branch = 규칙 id 또는 "else"(조건 불일치)
 */
export interface StoryEdge {
  from: string;
  fromPort: string;
  to: string;
}

export interface StoryBoard {
  vars: StoryVar[];
  nodes: StoryNode[];
  edges: StoryEdge[];
}

/* ========== 정규화 (클라이언트 JSON 방어) ========== */

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
export const i32 = (n: unknown): number =>
  Math.max(I32_MIN, Math.min(I32_MAX, Math.trunc(Number(n) || 0)));

const str = (v: unknown, max: number): string => String(v ?? "").slice(0, max);
const idStr = (v: unknown): string => str(v, 40).replace(/[^\w-]/g, "");

const TITLE_MAX = 100;
const TEXT_MAX = 8000;
const OPTION_MAX = 300;
const URL_MAX = 600;
const VAR_NAME_MAX = 32;
export const STORY_LIMITS = {
  nodes: 300,
  vars: 50,
  options: 10,
  rules: 10,
  /** 분기 조건 하나에 넣을 수 있는 항(and/or) 수 */
  terms: 8,
  varOps: 20,
};

function normVarOps(raw: unknown, varNames: Set<string>): StoryVarOp[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryVarOp[] = [];
  for (const o of raw.slice(0, STORY_LIMITS.varOps)) {
    const v = str((o as StoryVarOp)?.var, VAR_NAME_MAX).trim();
    if (!v || !varNames.has(v)) continue;
    out.push({
      var: v,
      op: (o as StoryVarOp)?.op === "set" ? "set" : "add",
      value: i32((o as StoryVarOp)?.value),
    });
  }
  return out;
}

/**
 * 외부에서 들어온 보드 JSON 을 안전한 형태로 정규화한다.
 * 모르는 필드 제거, 수치 보정, 깨진 엣지(없는 노드/포트, 중복 출력) 제거.
 */
export function normalizeStoryBoard(raw: unknown): StoryBoard {
  const r = (raw ?? {}) as Partial<StoryBoard>;

  // 변수 (이름 중복 제거)
  const vars: StoryVar[] = [];
  const varNames = new Set<string>();
  if (Array.isArray(r.vars)) {
    for (const v of r.vars.slice(0, STORY_LIMITS.vars)) {
      const name = str((v as StoryVar)?.name, VAR_NAME_MAX).trim();
      if (!name || varNames.has(name)) continue;
      varNames.add(name);
      vars.push({ name, initial: i32((v as StoryVar)?.initial) });
    }
  }

  // 노드 (start/end 는 각 1개 보장 — 없으면 생성, 초과는 제거)
  const nodes: StoryNode[] = [];
  const ids = new Set<string>();
  let hasStart = false;
  let hasEnd = false;
  if (Array.isArray(r.nodes)) {
    for (const n of r.nodes.slice(0, STORY_LIMITS.nodes)) {
      const node = n as StoryNode;
      const id = idStr(node?.id);
      if (!id || ids.has(id)) continue;
      const base = { id, x: Math.round(Number(node?.x) || 0), y: Math.round(Number(node?.y) || 0) };
      switch (node?.type) {
        case "start":
          if (hasStart) continue;
          hasStart = true;
          nodes.push({ ...base, type: "start" });
          break;
        case "end":
          if (hasEnd) continue;
          hasEnd = true;
          nodes.push({ ...base, type: "end" });
          break;
        case "story":
          nodes.push({
            ...base,
            type: "story",
            title: str((node as StoryCardNode).title, TITLE_MAX),
            text: str((node as StoryCardNode).text, TEXT_MAX),
            imageUrl: (node as StoryCardNode).imageUrl ? str((node as StoryCardNode).imageUrl, URL_MAX) : null,
            varOps: normVarOps((node as StoryCardNode).varOps, varNames),
          });
          break;
        case "choice": {
          const options: StoryChoiceOption[] = [];
          const optIds = new Set<string>();
          const rawOpts = (node as StoryChoiceNode).options;
          if (Array.isArray(rawOpts)) {
            for (const o of rawOpts.slice(0, STORY_LIMITS.options)) {
              const oid = idStr((o as StoryChoiceOption)?.id);
              if (!oid || optIds.has(oid)) continue;
              optIds.add(oid);
              options.push({
                id: oid,
                text: str((o as StoryChoiceOption)?.text, OPTION_MAX),
                varOps: normVarOps((o as StoryChoiceOption)?.varOps, varNames),
              });
            }
          }
          nodes.push({ ...base, type: "choice", options });
          break;
        }
        case "branch": {
          const normTerm = (t: unknown): StoryBranchTerm => {
            const o = (t ?? {}) as { var?: unknown; min?: unknown; max?: unknown };
            return {
              var: str(o.var, VAR_NAME_MAX).trim(),
              min: o.min == null || o.min === ("" as unknown) ? null : i32(o.min),
              max: o.max == null || o.max === ("" as unknown) ? null : i32(o.max),
            };
          };
          const rules: StoryBranchRule[] = [];
          const ruleIds = new Set<string>();
          const rawRules = (node as StoryBranchNode).rules;
          if (Array.isArray(rawRules)) {
            for (const ru of rawRules.slice(0, STORY_LIMITS.rules)) {
              const raw = (ru ?? {}) as Partial<StoryBranchRule> & { var?: unknown; min?: unknown; max?: unknown };
              const rid = idStr(raw.id);
              if (!rid || rid === "else" || ruleIds.has(rid)) continue;
              ruleIds.add(rid);
              // 신형: terms 배열 / 구형(단일 변수 조건 {var,min,max})은 항 1개로 변환
              const terms = Array.isArray(raw.terms)
                ? raw.terms.slice(0, STORY_LIMITS.terms).map(normTerm)
                : [normTerm(raw)];
              rules.push({ id: rid, logic: raw.logic === "or" ? "or" : "and", terms });
            }
          }
          nodes.push({ ...base, type: "branch", rules });
          break;
        }
        default:
          continue;
      }
      ids.add(id);
    }
  }
  if (!hasStart) nodes.unshift({ id: "start", type: "start", x: 40, y: 40 });
  if (!hasEnd) nodes.push({ id: "end", type: "end", x: 40, y: 560 });

  // 엣지: 유효한 노드/포트만, 출력 포트당 1개, 이전점 없는 노드(start)로의 연결 금지
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: StoryEdge[] = [];
  const usedPorts = new Set<string>();
  if (Array.isArray(r.edges)) {
    for (const e of r.edges) {
      const from = idStr((e as StoryEdge)?.from);
      const fromPort = str((e as StoryEdge)?.fromPort, 40);
      const to = idStr((e as StoryEdge)?.to);
      const src = nodeById.get(from);
      const dst = nodeById.get(to);
      if (!src || !dst) continue;
      if (dst.type === "start") continue;
      if (!outPortsOf(src).includes(fromPort)) continue;
      const key = `${from}:${fromPort}`;
      if (usedPorts.has(key)) continue;
      usedPorts.add(key);
      edges.push({ from, fromPort, to });
    }
  }

  return { vars, nodes, edges };
}

/** 노드의 출력 포트(다음점) id 목록 */
export function outPortsOf(node: StoryNode): string[] {
  switch (node.type) {
    case "start":
    case "story":
      return ["out"];
    case "choice":
      return node.options.map((o) => o.id);
    case "branch":
      return [...node.rules.map((r) => r.id), "else"];
    case "end":
      return [];
  }
}

/* ========== 공개 검증 ========== */

function nodeLabel(n: StoryNode): string {
  switch (n.type) {
    case "start":
      return "시작 카드";
    case "end":
      return "끝 카드";
    case "story":
      return `스토리 카드 "${n.title || "(제목 없음)"}"`;
    case "choice":
      return `선택지 카드 (${n.options.map((o) => o.text || "…").join(" / ").slice(0, 40)})`;
    case "branch":
      return "분기점 카드";
  }
}

/**
 * 공개 가능 여부 검증. 통과하면 빈 배열, 아니면 에러 메시지 목록.
 * - 시작에서 연결을 따라간 모든 노드의 모든 다음점이 연결되어 있어야 하고
 * - 도달 가능한 모든 노드에서 끝까지 갈 수 있어야 하며 (막다른 길/탈출 없는 루프 금지)
 * - 시작 → 끝 사이에 스토리 카드가 최소 1개 있어야 한다 (어느 경로로 가든)
 */
export function validateStoryBoard(board: StoryBoard): string[] {
  const errors: string[] = [];
  const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
  const start = board.nodes.find((n) => n.type === "start");
  const end = board.nodes.find((n) => n.type === "end");
  if (!start) errors.push("시작 카드가 없습니다.");
  if (!end) errors.push("끝 카드가 없습니다.");
  if (!start || !end) return errors;

  const varNames = new Set(board.vars.map((v) => v.name));
  const edgeByPort = new Map(board.edges.map((e) => [`${e.from}:${e.fromPort}`, e]));

  // 시작에서 도달 가능한 노드 수집 + 포트 연결 검사
  const reachable = new Set<string>();
  const stack = [start.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodeById.get(id);
    if (!node) continue;

    // 노드 자체 검사 (도달 가능한 노드만)
    if (node.type === "story") {
      if (!node.title.trim()) errors.push(`${nodeLabel(node)}: 타이틀을 입력하세요.`);
      if (!node.text.trim()) errors.push(`${nodeLabel(node)}: 장면 설정을 입력하세요.`);
      for (const op of node.varOps) {
        if (!varNames.has(op.var)) errors.push(`${nodeLabel(node)}: 없는 변수 "${op.var}" 를 조정합니다.`);
      }
    } else if (node.type === "choice") {
      if (node.options.length === 0) errors.push(`${nodeLabel(node)}: 선택지가 없습니다.`);
      for (const o of node.options) {
        if (!o.text.trim()) errors.push(`${nodeLabel(node)}: 비어 있는 선택지 텍스트가 있습니다.`);
        for (const op of o.varOps) {
          if (!varNames.has(op.var)) errors.push(`${nodeLabel(node)}: 없는 변수 "${op.var}" 를 조정합니다.`);
        }
      }
    } else if (node.type === "branch") {
      if (node.rules.length === 0) errors.push(`${nodeLabel(node)}: 조건이 없습니다.`);
      for (const [ri, r] of node.rules.entries()) {
        if (r.terms.length === 0) errors.push(`${nodeLabel(node)}: 조건 ${ri + 1}에 항이 없습니다.`);
        for (const t of r.terms) {
          if (!t.var || !varNames.has(t.var))
            errors.push(`${nodeLabel(node)}: 조건 ${ri + 1}이 없는 변수 "${t.var || "?"}" 를 비교합니다.`);
          if (t.min == null && t.max == null)
            errors.push(`${nodeLabel(node)}: 조건 ${ri + 1}에 비교 값이 비어 있는 항이 있습니다.`);
          if (t.min != null && t.max != null && t.min > t.max)
            errors.push(`${nodeLabel(node)}: 조건 ${ri + 1}의 범위 최소값이 최대값보다 큽니다 (${t.min} ~ ${t.max}).`);
        }
      }
    }

    for (const port of outPortsOf(node)) {
      const edge = edgeByPort.get(`${node.id}:${port}`);
      if (!edge) {
        const portName =
          node.type === "choice"
            ? `선택지 "${node.options.find((o) => o.id === port)?.text || "…"}"의 다음점`
            : node.type === "branch"
              ? port === "else"
                ? "조건 불일치(그 외)의 다음점"
                : "조건의 다음점"
              : "다음점";
        errors.push(`${nodeLabel(node)}: ${portName}이 연결되지 않았습니다.`);
        continue;
      }
      stack.push(edge.to);
    }
  }

  // 모든 도달 가능 노드에서 끝까지 갈 수 있는지 (끝에서 역방향 BFS)
  const canReachEnd = new Set<string>([end.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of board.edges) {
      if (canReachEnd.has(e.to) && !canReachEnd.has(e.from)) {
        canReachEnd.add(e.from);
        grew = true;
      }
    }
  }
  for (const id of reachable) {
    const node = nodeById.get(id);
    if (node && node.type !== "end" && !canReachEnd.has(id)) {
      errors.push(`${nodeLabel(node)}: 여기서 끝 카드까지 도달할 수 없습니다.`);
    }
  }

  // 시작 → 끝 모든 경로에 스토리 카드 ≥ 1 (스토리 카드를 거치지 않고 끝에 닿으면 실패)
  if (errors.length === 0) {
    const visited = new Set<string>();
    const q = [start.id];
    while (q.length > 0) {
      const id = q.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodeById.get(id);
      if (!node || node.type === "story") continue; // 스토리 카드 이후 경로는 통과
      if (node.type === "end") {
        errors.push("시작과 끝 사이에 스토리 카드가 최소 1개 있어야 합니다 (스토리 카드 없이 끝에 도달하는 경로가 있습니다).");
        break;
      }
      for (const port of outPortsOf(node)) {
        const edge = edgeByPort.get(`${node.id}:${port}`);
        if (edge) q.push(edge.to);
      }
    }
  }

  return errors;
}

/* ========== 플레이 엔진 ========== */

export interface StoryRunState {
  nodeId: string;
  vars: Record<string, number>;
  finished: boolean;
}

export interface StoryPlayView {
  status: "story" | "choice" | "finished";
  nodeId: string;
  /** 채팅창 상단에 실시간 표시할 타이틀 (스토리 카드의 타이틀) */
  title: string | null;
  text: string | null;
  imageUrl: string | null;
  options: { id: string; text: string }[] | null;
}

export function initialVars(board: StoryBoard): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const v of board.vars) vars[v.name] = v.initial;
  return vars;
}

function applyVarOps(vars: Record<string, number>, ops: StoryVarOp[]): void {
  for (const op of ops) {
    const cur = i32(vars[op.var] ?? 0);
    vars[op.var] = op.op === "set" ? i32(op.value) : i32(cur + op.value);
  }
}

const finishedView = (nodeId: string): StoryPlayView => ({
  status: "finished",
  nodeId,
  title: null,
  text: null,
  imageUrl: null,
  options: null,
});

/** 현재 상태를 다시 보여줄 뷰 (변수 조정 재적용 없음 — 재접속/새로고침용) */
export function viewOfState(board: StoryBoard, state: StoryRunState): StoryPlayView {
  if (state.finished) return finishedView(state.nodeId);
  const node = board.nodes.find((n) => n.id === state.nodeId);
  if (!node) return finishedView(state.nodeId);
  if (node.type === "story") {
    return { status: "story", nodeId: node.id, title: node.title, text: node.text, imageUrl: node.imageUrl ?? null, options: null };
  }
  if (node.type === "choice") {
    return {
      status: "choice",
      nodeId: node.id,
      title: null,
      text: null,
      imageUrl: null,
      options: node.options.map((o) => ({ id: o.id, text: o.text })),
    };
  }
  return finishedView(state.nodeId);
}

const MAX_HOPS = 200;

/**
 * nodeId 부터 그래프를 따라가며 다음 "멈추는 지점"(스토리/선택지/끝)까지 진행한다.
 * 분기점은 즉시 평가해 통과하고, 스토리 카드에 들어서는 순간 변수 조정을 적용한다.
 * state 를 직접 수정하고 뷰를 반환한다. (published 보드는 검증을 통과했지만 방어적으로 처리)
 */
function enterNode(board: StoryBoard, state: StoryRunState, startNodeId: string): StoryPlayView {
  const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
  const edgeByPort = new Map(board.edges.map((e) => [`${e.from}:${e.fromPort}`, e]));
  let nodeId = startNodeId;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const node = nodeById.get(nodeId);
    if (!node) break;
    if (node.type === "end") {
      state.nodeId = node.id;
      state.finished = true;
      return finishedView(node.id);
    }
    if (node.type === "story") {
      applyVarOps(state.vars, node.varOps);
      state.nodeId = node.id;
      return viewOfState(board, state);
    }
    if (node.type === "choice") {
      state.nodeId = node.id;
      return viewOfState(board, state);
    }
    if (node.type === "branch") {
      const termOk = (t: StoryBranchTerm) => {
        const v = i32(state.vars[t.var] ?? 0);
        return (t.min == null || v >= t.min) && (t.max == null || v <= t.max);
      };
      let port = "else";
      for (const r of node.rules) {
        const ok = r.terms.length > 0 && (r.logic === "or" ? r.terms.some(termOk) : r.terms.every(termOk));
        if (ok) {
          port = r.id;
          break;
        }
      }
      const edge = edgeByPort.get(`${node.id}:${port}`);
      if (!edge) break;
      nodeId = edge.to;
      continue;
    }
    // start
    const edge = edgeByPort.get(`${node.id}:out`);
    if (!edge) break;
    nodeId = edge.to;
  }
  // 연결이 끊겼거나 비정상 — 종료 처리
  state.nodeId = nodeId;
  state.finished = true;
  return finishedView(nodeId);
}

/** 런 시작(또는 재시작): 시작 카드부터 첫 멈춤 지점까지 진행 */
export function startStoryRun(board: StoryBoard): { state: StoryRunState; view: StoryPlayView } {
  const start = board.nodes.find((n) => n.type === "start");
  const state: StoryRunState = { nodeId: start?.id ?? "start", vars: initialVars(board), finished: false };
  const view = start ? enterNode(board, state, start.id) : finishedView(state.nodeId);
  return { state, view };
}

/** 스토리 카드에서 "계속" */
export function continueStoryRun(board: StoryBoard, state: StoryRunState): StoryPlayView {
  if (state.finished) return finishedView(state.nodeId);
  const node = board.nodes.find((n) => n.id === state.nodeId);
  if (!node || node.type !== "story") return viewOfState(board, state);
  const edge = board.edges.find((e) => e.from === node.id && e.fromPort === "out");
  if (!edge) {
    state.finished = true;
    return finishedView(state.nodeId);
  }
  return enterNode(board, state, edge.to);
}

/** 선택지 카드에서 옵션 선택 */
export function chooseStoryOption(board: StoryBoard, state: StoryRunState, optionId: string): StoryPlayView {
  if (state.finished) return finishedView(state.nodeId);
  const node = board.nodes.find((n) => n.id === state.nodeId);
  if (!node || node.type !== "choice") return viewOfState(board, state);
  const option = node.options.find((o) => o.id === optionId);
  if (!option) return viewOfState(board, state);
  const edge = board.edges.find((e) => e.from === node.id && e.fromPort === option.id);
  if (!edge) {
    state.finished = true;
    return finishedView(state.nodeId);
  }
  applyVarOps(state.vars, option.varOps);
  return enterNode(board, state, edge.to);
}

/* ========== 플레이 장면 (AI 생성 대화) ========== */

/**
 * 플레이 시 스토리 카드의 "장면 설정"으로 AI 가 쓴 대화 장면의 한 줄.
 * narr = 지문, char = 캐릭터 대사, player = 플레이어 대사 (둘 다 AI 가 쓴다 — 유저 입력 없음)
 */
export interface SceneLine {
  who: "narr" | "char" | "player";
  text: string;
}

/**
 * LLM 출력(줄 단위 대본)을 파싱한다. 형식:
 *   (지문)  /  {캐릭터명}: 대사  /  나: 플레이어 대사
 * 형식을 벗어난 줄은 캐릭터 대사로 취급 (프롬프트가 형식을 강제하지만 방어적으로).
 */
export function parseSceneLines(raw: string, charName: string): SceneLine[] {
  const out: SceneLine[] = [];
  const nameEsc = charName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const charRe = new RegExp(`^(?:${nameEsc})\\s*[:：]\\s*`);
  const playerRe = /^(?:나|플레이어)\s*[:：]\s*/;
  for (const lineRaw of String(raw ?? "").split("\n")) {
    const line = lineRaw.trim().replace(/^\*+|\*+$/g, "").trim();
    if (!line) continue;
    if (/^\(.*\)?$/.test(line) && line.startsWith("(")) {
      out.push({ who: "narr", text: line.replace(/^\(|\)$/g, "").trim() });
    } else if (playerRe.test(line)) {
      out.push({ who: "player", text: line.replace(playerRe, "").trim() });
    } else if (charRe.test(line)) {
      out.push({ who: "char", text: line.replace(charRe, "").trim() });
    } else {
      out.push({ who: "char", text: line });
    }
  }
  return out.filter((l) => l.text);
}

/** 장면 캐시 조회 (없으면 null) */
export async function getStorySceneCache(userId: number, storyId: number, nodeId: string): Promise<string | null> {
  const rows = await query<{ content: string }>(
    "SELECT content FROM user_story_scenes WHERE user_id = ? AND story_id = ? AND node_id = ?",
    [userId, storyId, nodeId]
  );
  return rows[0]?.content ?? null;
}

export async function saveStorySceneCache(userId: number, storyId: number, nodeId: string, content: string): Promise<void> {
  await execute(
    `INSERT INTO user_story_scenes (user_id, story_id, node_id, content) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [userId, storyId, nodeId, content]
  );
}

/* ========== AI 생성 컨텍스트 ========== */

/**
 * 스토리 카드 텍스트 AI 생성용 컨텍스트: 해당 카드로 들어오는 연결을 거슬러 올라가
 * 앞선 스토리 카드(최대 3개)와 직전 선택지 텍스트를 모은다.
 * 앞 연결이 없으면 빈 결과 → 호출부가 캐릭터 프로필로 대체한다.
 */
export function collectStoryGenContext(
  board: StoryBoard,
  nodeId: string
): { stories: { title: string; text: string }[]; choiceText: string | null } {
  const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
  const stories: { title: string; text: string }[] = [];
  let choiceText: string | null = null;
  let cur = nodeId;
  const seen = new Set<string>([nodeId]);
  for (let hop = 0; hop < 50 && stories.length < 3; hop++) {
    const incoming = board.edges.find((e) => e.to === cur);
    if (!incoming) break;
    const src = nodeById.get(incoming.from);
    if (!src || seen.has(src.id)) break;
    seen.add(src.id);
    if (src.type === "story") {
      stories.unshift({ title: src.title, text: src.text });
    } else if (src.type === "choice" && choiceText == null && stories.length === 0) {
      choiceText = src.options.find((o) => o.id === incoming.fromPort)?.text ?? null;
    } else if (src.type === "start") {
      break;
    }
    cur = src.id;
  }
  return { stories, choiceText };
}

/* ========== DB ========== */

export interface CharacterStoryRow {
  id: number;
  character_id: number;
  title: string;
  status: "draft" | "published";
  draft_json: string;
  published_json: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterStoryListItem {
  id: number;
  title: string;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
}

/** 새 보드 기본값: 시작/끝 카드만 */
export function emptyStoryBoard(): StoryBoard {
  return {
    vars: [],
    nodes: [
      { id: "start", type: "start", x: 60, y: 40 },
      { id: "end", type: "end", x: 60, y: 480 },
    ],
    edges: [],
  };
}

export async function listCharacterStories(characterId: number): Promise<CharacterStoryListItem[]> {
  return query<CharacterStoryListItem>(
    "SELECT id, title, status, published_at, updated_at FROM character_stories WHERE character_id = ? ORDER BY id DESC",
    [characterId]
  );
}

export async function getCharacterStory(storyId: number): Promise<CharacterStoryRow | null> {
  const rows = await query<CharacterStoryRow>("SELECT * FROM character_stories WHERE id = ?", [storyId]);
  return rows[0] ?? null;
}

export async function createCharacterStory(characterId: number, title: string): Promise<number> {
  const result = await execute(
    "INSERT INTO character_stories (character_id, title, draft_json) VALUES (?, ?, ?)",
    [characterId, title.slice(0, TITLE_MAX), JSON.stringify(emptyStoryBoard())]
  );
  return result.insertId;
}

export async function updateCharacterStoryDraft(storyId: number, title: string, board: StoryBoard): Promise<void> {
  await execute("UPDATE character_stories SET title = ?, draft_json = ? WHERE id = ?", [
    title.slice(0, TITLE_MAX),
    JSON.stringify(board),
    storyId,
  ]);
}

/** 공개: 검증 통과 시 draft 를 published 로 복사. 실패하면 에러 목록 반환 */
export async function publishCharacterStory(storyId: number): Promise<string[] | null> {
  const row = await getCharacterStory(storyId);
  if (!row) return ["스토리를 찾을 수 없습니다."];
  const board = normalizeStoryBoard(JSON.parse(row.draft_json));
  const errors = validateStoryBoard(board);
  if (errors.length > 0) return errors;
  await execute(
    "UPDATE character_stories SET status = 'published', published_json = ?, published_at = NOW() WHERE id = ?",
    [JSON.stringify(board), storyId]
  );
  return null;
}

/** 비공개 전환 (published_json 은 유지하되 목록/입장에서 제외) */
export async function unpublishCharacterStory(storyId: number): Promise<void> {
  await execute("UPDATE character_stories SET status = 'draft' WHERE id = ?", [storyId]);
}

export async function deleteCharacterStory(storyId: number): Promise<void> {
  await execute("DELETE FROM character_stories WHERE id = ?", [storyId]);
}

/** 플레이 입장용: 공개 상태 스토리 목록 */
export async function listPublishedStories(characterId: number): Promise<{ id: number; title: string }[]> {
  return query<{ id: number; title: string }>(
    "SELECT id, title FROM character_stories WHERE character_id = ? AND status = 'published' ORDER BY id",
    [characterId]
  );
}

export interface StoryRunRow {
  id: number;
  user_id: number;
  story_id: number;
  character_id: number;
  status: "active" | "finished";
  node_id: string;
  vars_json: string;
  finished_count: number;
}

export async function getStoryRun(userId: number, storyId: number): Promise<StoryRunRow | null> {
  const rows = await query<StoryRunRow>(
    "SELECT * FROM user_story_runs WHERE user_id = ? AND story_id = ?",
    [userId, storyId]
  );
  return rows[0] ?? null;
}

export async function saveStoryRun(
  userId: number,
  storyId: number,
  characterId: number,
  state: StoryRunState
): Promise<void> {
  await execute(
    `INSERT INTO user_story_runs (user_id, story_id, character_id, status, node_id, vars_json, finished_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status), node_id = VALUES(node_id), vars_json = VALUES(vars_json),
       finished_count = finished_count + IF(VALUES(status) = 'finished' AND status = 'active', 1, 0),
       finished_at = IF(VALUES(status) = 'finished', NOW(), finished_at)`,
    [userId, storyId, characterId, state.finished ? "finished" : "active", state.nodeId, JSON.stringify(state.vars), 0]
  );
}

export function runRowToState(row: StoryRunRow): StoryRunState {
  let vars: Record<string, number> = {};
  try {
    const parsed = JSON.parse(row.vars_json);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) vars[k] = i32(v);
    }
  } catch {
    vars = {};
  }
  return { nodeId: row.node_id, vars, finished: row.status === "finished" };
}
