// 프리로드 데모 작품: 현진건 「운수 좋은 날」 (1924, 저작권 만료 — 위키문헌)
// 글로서리는 수동 검수본. 오프셋/언급 위치/근거 세그먼트는 시드 시점에 원문 스캔으로 계산.

import fs from "fs";
import path from "path";
import type { Work, GlossaryType } from "./types";
import {
  getWork,
  saveWork,
  saveContentText,
  saveSegments,
  saveGlossary,
  saveBuildStatus,
  appendBuildLog,
} from "./store";
import { parseTxt } from "./parse";
import { materializeEntries, buildEmbeddingIndex } from "./pipeline";
import { getEmbedder } from "./embed";

const PRELOAD_ID = "unsu-joeun-nal";

interface SeedEntry {
  type: GlossaryType;
  name: string;
  aliases: string[];
  description: string;
}

// 스포일러 없는 기본 설명 (첫 등장 시점 기준). 본문에 명시된 정보만.
const SEED_GLOSSARY: SeedEntry[] = [
  // 인물
  { type: "인물", name: "김 첨지", aliases: ["김첨지", "첨지"], description: "동소문 안에서 인력거꾼 노릇을 하는 인물. 근 열흘 동안 돈 구경도 못하다가 이날 오래간만에 손님이 잇달아 닥치는 운수 좋은 날을 맞는다." },
  { type: "인물", name: "아내", aliases: ["병자", "마누라", "오라질 년"], description: "김 첨지의 아내. 달포가 넘게 기침을 쿨럭거리며 앓아누워 있고, 조밥을 급히 먹고 체한 뒤 병이 더쳤다. 설렁탕 국물을 마시고 싶어 한다." },
  { type: "인물", name: "개똥이", aliases: [], description: "김 첨지의 세 살 먹이 젖먹이 아들. 앓아누운 어머니 곁에서 빈 젖을 빨며 보챈다." },
  { type: "인물", name: "치삼", aliases: ["치삼이"], description: "김 첨지의 친구. 길가 선술집에서 김 첨지와 마주쳐 함께 술을 마신다." },
  { type: "인물", name: "앞집 마나님", aliases: ["마나님"], description: "이날 김 첨지가 처음으로 태운 손님. 전찻길까지 모셔다 드리고 삼십 전을 받았다." },
  // 용어
  { type: "용어", name: "인력거", aliases: ["인력거꾼"], description: "사람이 직접 끌어 손님을 태우는 두 바퀴 수레. 김 첨지의 생계 수단이다." },
  { type: "용어", name: "설렁탕", aliases: [], description: "소의 뼈와 고기를 고아 만든 국. 앓는 아내가 먹고 싶어 하는 음식으로, 이날 벌이로 사다 주고자 하는 목표가 된다." },
  { type: "용어", name: "모주", aliases: [], description: "재강에 물을 타 거칠게 거른 값싼 술. 컬컬한 목을 축이는 술로 언급된다." },
  { type: "용어", name: "백통화", aliases: [], description: "백통(구리·니켈 합금)으로 만든 동전. 김 첨지가 삯으로 받는 십 전짜리 은빛 돈." },
  { type: "용어", name: "조밥", aliases: [], description: "좁쌀로 지은 밥. 아내가 뜻밖에 얻어 급히 먹고 체하여 병이 더친 음식." },
  // 사건
  { type: "사건", name: "오래간만의 행운", aliases: ["운수 좋은 날", "재수"], description: "근 열흘 동안 돈 구경도 못하던 김 첨지에게 이날 아침부터 손님이 잇달아 닥쳐 삼십 전, 오십 전이 연이어 들어온 드문 벌이." },
  { type: "사건", name: "아내의 병", aliases: ["기침", "병"], description: "아내가 달포가 넘게 기침으로 앓아누운 일. 약 한 첩 써 본 일 없이 병세가 이어지고 있다." },
  { type: "사건", name: "학생 손님의 남대문행", aliases: ["학생"], description: "기차 시간에 맞춰 남대문 정거장까지 가려는 학생을 일 원 오십 전에 태우게 된 큰 벌이." },
  // 설정
  { type: "설정", name: "동소문", aliases: [], description: "서울 혜화문의 속칭. 김 첨지가 인력거꾼 노릇을 하는 근거지 동네다." },
  { type: "설정", name: "동광학교", aliases: [], description: "김 첨지가 교원인 듯한 양복장이 손님을 태워다 준 학교." },
  { type: "설정", name: "남대문 정거장", aliases: ["정거장"], description: "경성의 기차역. 학생 손님이 기차 시간에 맞춰 가려던 목적지다." },
  { type: "설정", name: "선술집", aliases: [], description: "서서 마시는 목로술집. 김 첨지가 치삼을 만나 술을 마시는 곳." },
  { type: "설정", name: "전찻길", aliases: ["전차"], description: "전차가 다니는 길. 김 첨지가 앞집 마나님을 모셔다 드린 곳이다." },
];

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  seeded = true;
  if (getWork(PRELOAD_ID)) return;

  const txtPath = path.join(process.cwd(), "preload", "unsu-joeun-nal.txt");
  if (!fs.existsSync(txtPath)) return;
  const raw = fs.readFileSync(txtPath, "utf8");

  const work: Work = {
    id: PRELOAD_ID,
    title: "운수 좋은 날",
    author: "현진건",
    type: "sequential",
    format: "txt",
    createdAt: new Date().toISOString(),
    textLength: 0,
    preloaded: true,
  };

  saveBuildStatus({ workId: PRELOAD_ID, phase: "파싱", done: false, logs: [] });
  appendBuildLog(PRELOAD_ID, "파싱", `프리로드 작품 로드: 「운수 좋은 날」 현진건 (저작권 만료, 위키문헌 TXT)`);

  // 1) 파싱
  const parsed = parseTxt(PRELOAD_ID, raw);
  work.textLength = parsed.text.length;
  saveWork(work);
  saveContentText(PRELOAD_ID, parsed.text);
  saveSegments(PRELOAD_ID, parsed.segments);
  appendBuildLog(
    PRELOAD_ID,
    "파싱",
    `파싱 완료: ${parsed.segments.length}개 문단 세그먼트, 총 ${parsed.text.length.toLocaleString()}자 (전역 문자 오프셋 부여)`
  );

  // 2) 글로서리 (수동 검수본 적용 — 본문 스캔으로 언급 위치/첫 등장/근거 세그먼트 계산)
  appendBuildLog(PRELOAD_ID, "글로서리 추출", `글로서리 적용: 수동 검수본 ${SEED_GLOSSARY.length}개 항목 (본문 명시 정보만, 스포일러 배제 원칙)`);
  const entries = materializeEntries(
    PRELOAD_ID,
    SEED_GLOSSARY,
    parsed.text,
    parsed.segments
  ).filter((e) => e.mentionOffsets.length > 0);
  saveGlossary(PRELOAD_ID, entries);
  const byType = entries.reduce<Record<string, number>>((acc, g) => {
    acc[g.type] = (acc[g.type] ?? 0) + 1;
    return acc;
  }, {});
  appendBuildLog(
    PRELOAD_ID,
    "병합",
    `병합/검증 완료: ${entries.length}개 항목 (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ")}) — 별칭 통합, 언급 오프셋 ${entries.reduce((s, e) => s + e.mentionOffsets.length, 0)}건 계산`
  );

  // 3) 임베딩
  const embedder = getEmbedder();
  appendBuildLog(PRELOAD_ID, "임베딩 인덱싱", `임베딩 인덱스 구축 중 — ${embedder.name}/${embedder.model} (${embedder.dim}차원)`);
  await buildEmbeddingIndex(PRELOAD_ID, parsed.segments, entries);
  appendBuildLog(
    PRELOAD_ID,
    "임베딩 인덱싱",
    `인덱스 완료: 세그먼트 ${parsed.segments.length}건 + 글로서리 ${entries.length}건 벡터화 (메모리 코사인 검색)`
  );
  appendBuildLog(PRELOAD_ID, "완료", "지식베이스 구축 완료 — 뷰어에서 열람 가능");
}
