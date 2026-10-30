/**
 * 하루 전용 사전(character_id=7)에 남은 데이터 가공 라벨((근거: …), 출처 번호, '원문' 표기, 검색어 줄, (짐작) 등)을 정리한다.
 * 대사 인용은 모두 보존하고, 라벨/출처만 제거한다. 바뀐 항목만 UPDATE + 재임베딩.
 * 실행: npx tsx scripts/clean-haru-dict-meta.ts          (DRY=1 이면 DB 변경 없이 통계/잔존 확인만)
 */
import fs from "fs";
import { query, execute, embedPassage, getPool, getRedis, invalidateChatContext } from "../packages/core/src/index";

const stats: Record<string, number> = {};
const bump = (k: string, n: number) => { if (n) stats[k] = (stats[k] ?? 0) + n; };

function soften(str: string, pos: number): string {
  const head = str.slice(0, pos);
  const cands: [number, number][] = [[head.lastIndexOf(". "), 2], [head.lastIndexOf("\n"), 1], [head.lastIndexOf(": "), 2]];
  let start = 0;
  for (const [i, l] of cands) if (i >= 0) start = Math.max(start, i + l);
  const lineStart = str.lastIndexOf("\n", pos - 1) + 1;
  if (str.slice(lineStart).startsWith("하루가 부르는 말")) return str;
  const seg = str.slice(start, pos);
  if (seg.length < 12 || /^(원문|규칙)/.test(seg)) return str;
  if (/^\s*아마/.test(str.slice(start))) return str;
  return str.slice(0, start) + "아마 " + str.slice(start);
}

function clean(input: string): string {
  let t = input;
  const rep = (re: RegExp, to: string, key: string) => {
    const n = (t.match(re) ?? []).length;
    if (n) { t = t.replace(re, to); bump(key, n); }
  };

  // 검색어 줄 (aliases 로만 사용)
  rep(/^검색어:.*\n?/gm, "", "검색어 줄 제거");

  // (짐작) / (짐작: …) 표기 → 문장 앞에 "아마" (괄호 안 내용은 근거 메모라 버림)
  for (;;) {
    const m = t.match(/\s*\(짐작(?::[^)]*)?\)/);
    if (!m || m.index === undefined) break;
    const idx = m.index;
    t = t.slice(0, idx) + t.slice(idx + m[0].length);
    t = soften(t, idx);
    bump("짐작 표기", 1);
  }
  rep(/\s*\(근거:(?:[^()]|\([^()]*\))*\)/g, "", "(근거: …) 출처 표기");
  // 근거 제거 후 남은 공백 정리는 마지막에
  rep(/\s*\(CINE[^)]*\)/g, "", "(CINE …) 출처 표기");
  rep(/\s*\(\d{4,6}(?:\s*[,~]\s*\d{3,6})*\)/g, "", "(숫자 ID) 출처 표기");
  rep(/\s*\(\d{4,6}\s*,\s*[^)]*\)/g, "", "(숫자 ID) 출처 표기");

  // 챕터 / 챗봇
  rep(/\s*\(챕터 \d+[^)]*\)/g, "", "챕터 번호");
  rep(/챕터 \d+의 /g, "이후의 ", "챕터 번호");
  rep(/챗봇에서 /g, "이 대화에서 ", "챗봇 표현");

  // 제목 줄 헤더
  rep(/하루 원문 대사 \(/g, "하루의 대사 예시 (", "'원문 대사' 헤더");

  // '원문' 출처 표현
  rep(/\s*\(원문[^)]*\)/g, "", "(원문 …) 출처 괄호");
  rep(/원문에서 직접 부른 (?:말|적)(?:은)? 없음\.?\s*/g, "", "'원문에서 직접 부른 말 없음'");
  rep(/원문 직접 호칭 없음\.?\s*/g, "", "'원문 직접 호칭 없음'");
  rep(/원문 없음/g, "직접 부르는 장면 없음", "'원문 없음'");
  rep(/원문에서는 /g, "", "원문 표기");
  rep(/원문에서 (하루(?:는|가))/g, "$1", "원문 표기");
  rep(/하루 플레이 원문에서 근거를 찾지 못했다/g, "근거를 찾지 못했다", "원문 표기");
  rep(/하루 쪽 원문에 없다/g, "하루 쪽에는 알려진 바 없다", "원문 표기");
  rep(/원문에 사라졌다는 언급 없음/g, "사라졌다는 언급은 없음", "원문 표기");
  rep(/원문에 (하루(?:의|가)? )/g, "$1", "원문 표기");
  rep(/원문에 직접 평가는 없다/g, "직접 평가는 없다", "원문 표기");
  rep(/원문에 없는 /g, "알려지지 않은 ", "원문 표기");
  rep(/원문에 없다/g, "알려지지 않았다", "원문 표기");
  rep(/원문에 나오지 않는다/g, "알려지지 않았다", "원문 표기");
  rep(/\s*\(CUTSCENE[^)]*\)/g, "", "(CUTSCENE …) 출처 표기");
  rep(/CINE Dreadfulecho에는 /g, "", "(CINE …) 출처 표기");
  rep(/이머전시 콜 CINE는 /g, "이머전시 콜 장면은 ", "(CINE …) 출처 표기");
  rep(/CINE\(이머전시 콜 EP04 2섹터\)에/g, "이머전시 콜 장면에", "(CINE …) 출처 표기");
  rep(/CINE CorruptedRecord의 /g, "일부 자료의 ", "(CINE …) 출처 표기");
  rep(/CINE 이머전시 콜·/g, "이머전시 콜·", "(CINE …) 출처 표기");
  rep(/원문에 없으니/g, "알려지지 않았으니", "원문 표기");
  rep(/원문에 없고/g, "없고", "원문 표기");
  rep(/원문에 (정해진|디그니티)/g, "$1", "원문 표기");
  rep(/끝부분의 (?=하이푸)/g, "", "(숫자 ID) 출처 표기");
  rep(/원문도 다 밝히지 않는다/g, "다 밝혀지지 않았다", "원문 표기");
  rep(/원문에 (분명하지 않다|설명이 없다|공개되지 않았다|명시 없음|있다|남은 것은|직접 나오지 않는다)/g, "$1", "원문 표기");
  rep(/원문에 거의 없다/g, "거의 알려져 있지 않다", "원문 표기");
  rep(/원문에 결과가 없다/g, "결과가 알려지지 않았다", "원문 표기");
  rep(/원문에 남아 있지 않다/g, "알려지지 않았다", "원문 표기");
  rep(/원문에 나오지 않으니/g, "알려지지 않았으니", "원문 표기");
  rep(/원문에 루나 녹스의 대사가 없다/g, "루나 녹스의 대사가 없다", "원문 표기");
  rep(/원문으로는 (알 수 없다|확인되지 않는다)/g, "$1", "원문 표기");
  rep(/원문으로 확인되지 않는다/g, "확인되지 않는다", "원문 표기");
  rep(/원문상 /g, "", "원문 표기");
  rep(/원문 표기(는|가)/g, "표기$1", "원문 표기");
  rep(/원문 대사/g, "대사", "원문 표기");
  rep(/원문끼리/g, "자료끼리", "원문 표기");
  rep(/원문과 맞지 않거나/g, "설정과 맞지 않거나", "원문 표기");
  rep(/원문을 인용할 때/g, "대사를 인용할 때", "원문 표기");
  rep(/원문 602510에 /g, "", "원문 표기");
  rep(/원문 /g, "", "원문 표기");
  rep(/3069\(604702\/604703\) 등 /g, "", "챕터 번호");
  rep(/노트의 730005 등/g, "노트 등", "(숫자 ID) 출처 표기");
  rep(/\s*\(\s*\d{5,6}(?:[·\/,~]\d{5,6})*\s*(?:끝|완료|후반|앞부분|줄거리)?\s*\)/g, "", "(숫자 ID) 출처 표기");
  rep(/\s*\([^()]*\b\d{6}\b[^()]*\)/g, "", "(숫자 ID) 출처 표기");
  rep(/\d{5,6}(?:[·\/,~]\d{5,6})*의 /g, "", "(숫자 ID) 출처 표기");
  rep(/\b\d{6}(?:와|과|에서|에|은|이)? (?=[끝가이앞작"'])/g, "", "(숫자 ID) 출처 표기");
  rep(/\b\d{6}(?:와|과)\s/g, "", "(숫자 ID) 출처 표기");
  rep(/\b\d{6}\b\s*(?:끝부분의|이후|가운데)\s*/g, "", "(숫자 ID) 출처 표기");
  rep(/\s*\(30\d{2} 이후\)/g, " (기준 시점 이후)", "챕터 번호");
  rep(/\s*\(30\d{2}[^()]*\)/g, "", "챕터 번호");
  rep(/\b30\d{2}(?:\s*(?:무렵|끝|시점))?(?:에서|에|의|부터)?\s+(?!년)/g, "", "챕터 번호");
  rep(/원문(?:에서|만으로)\s*/g, "", "원문 표기");
  rep(/원문에는 /g, "", "원문 표기");
  rep(/원문의 /g, "", "원문 표기");
  rep(/원문은 /g, "", "원문 표기");
  rep(/원문이 /g, "", "원문 표기");
  rep(/를 기억한다는 원문은 없다/g, "를 기억한다는 내용은 없다", "원문 표기");

  rep(/\d{6}(?:에서|와|과|의)?\s*/g, "", "(숫자 ID) 출처 표기");
  // 공백 정리
  t = t.replace(/[ \t]+$/gm, "").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

async function main() {
  const rows = await query<{ id: number; title: string; aliases: string | null; content: string }>(
    "SELECT id, title, aliases, content FROM world_dictionary WHERE character_id = 7 ORDER BY id"
  );
  const changed: { id: number; title: string; content: string; aliases: string | null }[] = [];
  const out: string[] = [];
  for (const r of rows) {
    const c = clean(r.content);
    if (c !== r.content) {
      changed.push({ id: r.id, title: r.title, aliases: r.aliases, content: c });
      out.push(`#${r.id} ${r.title}\n${c}\n`);
    }
  }
  fs.writeFileSync("D:/Works_Tool/VChatBot/scripts/_haru-clean-preview.txt", out.join("\n====\n"));
  const left: Record<string, number> = {};
  for (const r of changed)
    for (const m of r.content.matchAll(/원문|근거|CINE|\(짐작|짐작:|챗봇|챕터|\(\d{4,6}|검색어:|RAG|SNS|메신저/g)) left[m[0]] = (left[m[0]] ?? 0) + 1;
  console.log("대상", rows.length, "변경", changed.length, stats, "잔존", left);
  if (process.env.DRY) { getRedis().disconnect(); await getPool().end(); process.exit(0); }

  for (const r of changed) {
    const emb = JSON.stringify(await embedPassage(`${r.title} ${r.aliases ?? ""} ${r.content.slice(0, 1500)}`));
    await execute("UPDATE world_dictionary SET content = ?, embedding = ? WHERE id = ?", [r.content, emb, r.id]);
  }
  await invalidateChatContext();
  console.log("UPDATE + 재임베딩 완료:", changed.length);
  getRedis().disconnect();
  await getPool().end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
