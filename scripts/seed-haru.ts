/**
 * 샘플 데이터(sampledata/)를 소울워커 세계관(id 2)에 시드한다.
 * - haru_data.txt  : RAG 청크(인물/조직/용어) → world_dictionary (+ 로컬 임베딩)
 * - common_data.txt: 세계관 설명/지명/용어 → worlds.description/ai_prompt + 사전 항목
 * - haru_prompt.txt: 캐릭터 지침 전문 → characters.ai_prompt
 * 실행: npx tsx scripts/seed-haru.ts   (레포 루트에서, DB 기동 상태)
 * 재실행 가능: 소울워커 사전 전체와 '하루 에스티아' 캐릭터를 지우고 다시 넣는다.
 */
import fs from "fs";
import path from "path";
import { query, execute, embedPassage, getPool, invalidateChatContext, getRedis } from "../packages/core/src/index";

const WORLD_ID = 2; // 소울워커
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, "sampledata", f), "utf8");

const CATEGORY_MAP: Record<string, "location" | "person" | "term"> = {
  인물: "person",
  장소: "location",
  지역: "location",
  조직: "term",
  용어: "term",
  사건: "term",
  기록: "term",
  세력: "term",
  개념: "term",
};

interface Entry {
  category: "location" | "person" | "term";
  title: string;
  aliases: string | null;
  content: string;
}

function capAliases(raw: string): string | null {
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  let out = "";
  for (const item of items) {
    const next = out ? `${out},${item}` : item;
    if (next.length > 255) break;
    out = next;
  }
  return out || null;
}

function parseChunks(text: string): Entry[] {
  const blocks = text.split(/\r?\n---\r?\n/);
  const entries: Entry[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const header = trimmed.split(/\r?\n/)[0];
    const m = header.match(/^(인물|장소|지역|조직|용어|사건|기록|세력|개념):\s*(.+)$/);
    if (!m) continue; // 서문(출처/구조 설명)은 건너뜀
    const aliasLine = trimmed.split(/\r?\n/).find((l) => l.startsWith("검색어:"));
    entries.push({
      category: CATEGORY_MAP[m[1]],
      title: m[2].trim().slice(0, 128),
      aliases: aliasLine ? capAliases(aliasLine.slice("검색어:".length)) : null,
      content: trimmed,
    });
  }
  return entries;
}

// common_data.txt 에서 뽑은 핵심 항목 (RAG 청크에 이미 있으면 건너뜀)
const COMMON_ENTRIES: Entry[] = [
  { category: "location", title: "로코 타운", aliases: null, content: "공백에서 귀환한 워커들이 처음 도착하는 클라우드림 서부의 시작점 도시." },
  { category: "location", title: "캔더스 시티", aliases: null, content: "네드 컴퍼니의 연구소가 위치한 도시. 소울정크와 관련된 비극적인 사건이 많이 일어났다." },
  { category: "location", title: "그레이스 시티", aliases: "그레이스", content: "별숲리그의 본부가 있는 대도시이자 인류 저항의 중심지." },
  { category: "location", title: "루인 포트리스", aliases: null, content: "버려진 군사 시설. 기계 군단과 고도의 기술력이 집약된 위험 지역으로 몹시 춥다." },
  { category: "term", title: "공백", aliases: "The Void,보이드", content: "15년 전 하늘에 나타난 거대한 백색 구체. 모든 것을 집어삼키고 세상에 재앙을 가져온 근원." },
  { category: "term", title: "소울워커", aliases: "SoulWorker,워커", content: "공백에 휩쓸렸다가 생존해 돌아온 이들. 감정을 '소울' 에너지로 변환해 초인적인 힘을 발휘하는 전사들." },
  { category: "term", title: "소울정크", aliases: "SoulJunk,정크", content: "공백의 에너지가 생명체나 사물에 스며들어 변이된 괴물. 지능은 낮지만 강력한 파괴 본능을 가진다." },
  { category: "term", title: "베시", aliases: "Vessie", content: "공백 내부에서 건너온 이계의 종족. 래피드 플레임처럼 인류를 적대하는 집단과 우호적인 집단으로 나뉜다." },
  { category: "term", title: "데자이어 워커", aliases: "DesireWorker,데자이어워커", content: "파괴적인 욕망에 완전히 잠식된 워커. 압도적으로 강력하지만 이성을 잃은 경우가 많다." },
  { category: "term", title: "소울럼 웨폰", aliases: "소울 웨폰,소울럼", content: "워커의 영혼이 형상화된 무기의 통칭." },
  { category: "term", title: "6구역", aliases: "식스존", content: "공백의 영향이 가장 강하게 남은 위험 지역. 워커들 간의 대련이나 특수 임무가 수행되는 곳." },
  { category: "term", title: "클라우드림", aliases: "Cloudream", content: "인류가 생존해 있는 거대 대륙의 명칭." },
  { category: "term", title: "별숲리그", aliases: "Starry Forest League,별숲 리그", content: "공백의 위협으로부터 인류를 지키기 위해 결성된 범지구적 방위 기구. 주인공들이 소속된 단체." },
  { category: "term", title: "로드즈", aliases: "Lord's", content: "별숲리그 상층부를 차지한 의문의 권력 집단. 인류의 구원보다 자신들의 이익과 목적을 우선시하기도 한다." },
  { category: "term", title: "네드 컴퍼니", aliases: "Ned Company,네드", content: "공백 발생 전부터 존재하던 거대 기업. 소울정크 연구와 병기 개발 등 어두운 실험을 자행해 왔다." },
];

const WORLD_DESCRIPTION = `인류의 재앙인 '공백(The Void)'이 발생한 후의 세상, 거대 대륙 '클라우드림'이 무대다. 공백은 15년 전 하늘에 나타난 거대한 백색 구체로, 모든 것을 집어삼키고 세상에 재앙을 가져온 근원이다. '소울워커'는 공백에 휩쓸렸다가 생존해 돌아온 이들로, 자신의 감정을 '소울' 에너지로 변환해 초인적인 힘을 발휘하는 전사들이다. 범지구적 방위 기구 '별숲리그'를 중심으로 변이 괴물 '소울정크', 이계 종족 '베시', 욕망에 잠식된 '데자이어 워커'에 맞서 싸운다. 별숲리그 상층부의 권력 집단 '로드즈'와 어두운 실험을 자행하는 거대 기업 '네드 컴퍼니'의 그림자도 드리워져 있다.`;

const WORLD_AI_PROMPT = `게임 '소울워커'의 공식 설정을 따르는 근미래 어반 판타지 세계다.
- 설정과 용어(공백, 소울워커, 소울정크, 베시, 데자이어 워커, 별숲리그, 클라우드림 등)를 일관되게 사용하고, 제공된 설정에 없는 사실을 지어내지 마라. 모르는 것은 모른다고 답한다.
- 유저는 게임 밖의 팬으로, 캐릭터와 SNS/메신저로 대화하는 상황이다. 동작·지문·괄호 묘사 없이 대사만 출력하라.
- 현대 현실의 시사·정치·게임 운영(공략/업데이트/과금) 질문에는 캐릭터가 알 수 없는 일로 자연스럽게 사양한다.`;

const HARU = {
  name: "하루 에스티아",
  profile: `게임 '소울워커'의 주인공. 17세에 '공백'에 휩쓸려 그 안에서 15년을 보낸 뒤 19세의 모습으로 귀환한 소울워커. 이명은 '복수의 소울럼 소드', 무기는 거대한 대검(소울럼 소드)이지만 평소엔 그냥 '검'이라 부른다. 165cm / 52kg, 9월 10일생, A형. 좋아하는 것은 고기 요리와 빵, 어머니, 평화로운 일상. 싫어하는 것은 소울정크와 사람이 희생당하는 것.
공백 사건으로 어머니를 잃었으나 그 괴로운 기억은 내면의 '그 아이'(데자이어 하루)가 대신 지니고 있어 본인의 기억은 흐릿하다. 복수심으로 검을 들었지만 지금은 사람들을 지키기 위해 싸우는 별숲리그 소울워커 팀의 리더. 원래 의사를 꿈꾸던 소녀라 전투가 없을 때는 병원 일을 돕는다. 현재 시점은 시즌 2 '진화의 말로' 직후.`,
  personality: `순하고 예의 바르며 타인을 배려하는 마음이 깊다. 겁이 많아 놀라거나 당황하면 말을 더듬고("노, 농담이죠?"), 귀신 같은 무서운 것을 질색하며, 칭찬을 받으면 "저 같은 게…"라며 자신을 낮춘다. 그러나 사람이 위험에 처하거나 불의 앞에서는 물러서지 않는 단호함과 강인함으로 돌변하고, 사람을 해치는 적에게는 일말의 자비도 없다. 복수가 아닌 수호를 위해 싸우기로 결심했으며, 리더로서의 책임감으로 소심함을 극복해 간다. 결정이 필요한 순간에는 빠르고 단호하다.`,
  speech_style: `기본은 표준어 존댓말, 차분하고 부드러운 어조. 말끝은 "~어요/~네요/~가요?/~죠"로 맺고 정색하거나 보고할 때는 "~습니다"를 쓴다. 1인칭은 항상 "저". 곤란하면 "아하하…", 쑥스러우면 "헤헤", 말줄임표(…)를 자주 쓴다. 이모지·'ㅋㅋ'·물결(~)과 "히익" 같은 비명 감탄사는 쓰지 않는다 (놀라면 "어?", "헉" 정도). 동료는 이름 뒤에 '씨'를 붙여 존댓말(어윈 씨, 릴리 씨)을 쓰되 스텔라와 치이에게만은 이름만 부르며 반말. 전투·분노 시에는 "용서하지 않겠어", "비켜!"처럼 서늘하고 단호한 반말로 급변하며, 하루는 곧바로 평소 말투로 돌아와 사과하곤 한다.`,
  scenario: `시즌 2 '진화의 말로' 직후. 거대한 나무로 변한 비스타를 토벌하는 큰 작전을 막 끝내고, 아르카디아 렐름에서 잠시 숨을 돌리고 있다. 하루는 SNS(메신저)로 바깥 세계의 사람들과 소통하는 중이다 — 큰 싸움을 마쳐 지쳤지만 리더로서의 책임감을 잃지 않았고, 복수심에 조바심 내는 토마스 씨와 중상을 입은 빅터 씨를 걱정하고 있다.`,
  greeting: `안녕하세요. 오늘도 무사히 돌아오셔서 정말 다행이에요. 아… 그쪽엔 소울정크가 없지요? 미안해요, 버릇처럼… 아하하. 저는 별숲리그의 소울워커, 하루 에스티아라고 해요. 잘 부탁드려요.`,
};

async function main() {
  const haruData = read("haru_data.txt");
  const haruPrompt = read("haru_prompt.txt");

  const chunkEntries = parseChunks(haruData);
  const chunkTitles = new Set(chunkEntries.map((e) => e.title));
  const commonEntries = COMMON_ENTRIES.filter((e) => !chunkTitles.has(e.title));
  const entries = [...commonEntries, ...chunkEntries];
  console.log(`청크 ${chunkEntries.length}건 + 공통 ${commonEntries.length}건 = 총 ${entries.length}건`);

  // 재실행 가능하도록 기존 데이터 정리
  await execute("DELETE FROM world_dictionary WHERE world_id = ?", [WORLD_ID]);
  const old = await query<{ id: number }>(
    "SELECT id FROM characters WHERE world_id = ? AND name = ?",
    [WORLD_ID, HARU.name]
  );
  for (const row of old) await execute("DELETE FROM characters WHERE id = ?", [row.id]);

  // 세계관 기본 설정
  await execute(
    "UPDATE worlds SET description = ?, ai_prompt = ?, visibility = 'open', status = 'active', is_active = 1 WHERE id = ?",
    [WORLD_DESCRIPTION, WORLD_AI_PROMPT, WORLD_ID]
  );

  // 캐릭터를 먼저 생성해 id 확보 (하루 전용 사전 항목이 참조)
  const result = await execute(
    `INSERT INTO characters (world_id, name, profile, personality, speech_style, ai_prompt, scenario, greeting, visibility, status, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'active', 1)`,
    [WORLD_ID, HARU.name, HARU.profile, HARU.personality, HARU.speech_style, haruPrompt, HARU.scenario, HARU.greeting]
  );
  const haruId = result.insertId;

  // 사전 삽입 + 임베딩 (로컬 CPU — 수 분 소요 가능)
  // common_data 항목은 세계관 공통(character_id NULL), haru_data 청크는 하루 전용
  let sort = 0;
  let embedded = 0;
  for (const e of entries) {
    const scopeCharacterId = chunkEntries.includes(e) ? haruId : null;
    let embedding: string | null = null;
    try {
      const vec = await embedPassage(`${e.title} ${e.aliases ?? ""} ${e.content.slice(0, 1500)}`);
      embedding = JSON.stringify(vec);
      embedded++;
    } catch (err) {
      console.error(`임베딩 실패(${e.title}):`, (err as Error).message);
    }
    await execute(
      `INSERT INTO world_dictionary (world_id, character_id, category, title, aliases, content, embedding, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [WORLD_ID, scopeCharacterId, e.category, e.title, e.aliases, e.content, embedding, sort++]
    );
    if (sort % 20 === 0) console.log(`  ${sort}/${entries.length}...`);
  }

  console.log(
    `완료: 캐릭터 '하루 에스티아' id=${haruId}, 사전 ${entries.length}건(공통 ${commonEntries.length} + 하루 전용 ${chunkEntries.length}, 임베딩 ${embedded}건)`
  );
  await invalidateChatContext(); // 컨텍스트 + 목록 캐시 무효화
  getRedis().disconnect();
  await getPool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
