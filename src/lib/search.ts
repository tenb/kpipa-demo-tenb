// 조회 플로우: 선택 → 글로서리 매칭 + 세그먼트 검색 → LLM 근거 제한 생성

import type {
  Work,
  Segment,
  GlossaryEntry,
  SelectionUnit,
  ExplainResponse,
  Citation,
  GlossaryCard,
} from "./types";
import { getSegments, getGlossary, getEmbeddings } from "./store";
import { matchesName, containsName } from "./korean";
import { getEmbedderFor, cosine } from "./embed";
import { getLLM, type LLMMessage } from "./llm";

const CONTEXT_WINDOW: Record<SelectionUnit, number> = {
  word: 1, // ±1문단
  sentence: 2, // ±2문단
  paragraph: 3, // ±3문단
};

export interface RetrievalResult {
  glossaryMatches: GlossaryEntry[];
  evidenceSegments: Segment[];
  contextSegments: Segment[];
  spoilerFiltered: { segments: number; glossary: number };
}

function toCard(g: GlossaryEntry): GlossaryCard {
  return {
    id: g.id,
    type: g.type,
    name: g.name,
    aliases: g.aliases,
    description: g.description,
    firstAppearanceOffset: g.firstAppearanceOffset,
    mentionCount: g.mentionOffsets.length,
  };
}

function toCitation(s: Segment, maxLen = 160): Citation {
  return {
    quote: s.text.length > maxLen ? s.text.slice(0, maxLen) + "…" : s.text,
    chapterIdx: s.chapterIdx,
    paraIdx: s.paraIdx,
    offset: s.startOffset,
    segmentId: s.id,
  };
}

/** 글로서리 + 세그먼트 검색 (스포일러 차단 적용) */
export async function retrieve(
  work: Work,
  queryText: string,
  selectionOffset: number,
  unit: SelectionUnit,
  readingPosition: number,
  spoilerBlock: boolean
): Promise<RetrievalResult> {
  const allSegments = getSegments(work.id);
  const allGlossary = getGlossary(work.id);
  const blocking = spoilerBlock && work.type === "sequential";
  const limit = blocking ? readingPosition : Infinity;

  // ① 글로서리 매칭 (별칭 포함 + 조사 제거), firstAppearanceOffset ≤ readingPosition
  const nameMatched = allGlossary.filter((g) => {
    const names = [g.name, ...g.aliases];
    return unit === "word"
      ? matchesName(queryText, names)
      : containsName(queryText, names);
  });
  const glossaryMatches = nameMatched.filter((g) => g.firstAppearanceOffset <= limit);
  const glossaryBlocked = nameMatched.length - glossaryMatches.length;

  // ② 문맥 윈도우 (선택 위치 주변 ±N문단)
  const win = CONTEXT_WINDOW[unit];
  const selIdx = allSegments.findIndex(
    (s) => selectionOffset >= s.startOffset && selectionOffset <= s.endOffset
  );
  const contextSegments =
    selIdx >= 0
      ? allSegments.slice(Math.max(0, selIdx - win), selIdx + win + 1)
      : [];
  const contextIds = new Set(contextSegments.map((s) => s.id));

  // ③ 임베딩 top-k 세그먼트 검색, endOffset ≤ readingPosition
  const candidates = allSegments.filter((s) => !contextIds.has(s.id));
  const allowed = candidates.filter((s) => s.endOffset <= limit);
  const segmentsBlocked = candidates.length - allowed.length;

  let evidenceSegments: Segment[] = [];
  const index = getEmbeddings(work.id);
  if (index && allowed.length) {
    // 질의 벡터는 인덱스와 같은 임베딩 공간에서 생성
    const embedder = getEmbedderFor(index.provider);
    if (embedder) {
      try {
        const [qv] = await embedder.embed([queryText]);
        evidenceSegments = allowed
          .map((s) => ({ s, score: index.segments[s.id] ? cosine(qv, index.segments[s.id]) : -1 }))
          .filter((x) => x.score > 0.05)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.s);
      } catch {
        evidenceSegments = [];
      }
    }
  }
  // 글로서리 근거 세그먼트 보강
  for (const g of glossaryMatches) {
    for (const sid of g.evidenceSegmentIds.slice(0, 2)) {
      const seg = allSegments.find((s) => s.id === sid);
      if (seg && seg.endOffset <= limit && !evidenceSegments.some((e) => e.id === seg.id) && !contextIds.has(seg.id)) {
        evidenceSegments.push(seg);
      }
    }
  }
  evidenceSegments = evidenceSegments.slice(0, 6);

  return {
    glossaryMatches,
    evidenceSegments,
    contextSegments,
    spoilerFiltered: { segments: segmentsBlocked, glossary: glossaryBlocked },
  };
}

function buildSystemPrompt(work: Work, blocking: boolean): string {
  return [
    `당신은 문학 작품 「${work.title}」의 맥락 해설 도우미입니다. 독자가 본문에서 선택한 단어·문장·문단을 해설합니다.`,
    "",
    "규칙 (반드시 지킬 것):",
    "1. 아래 [근거]로 제공된 글로서리 항목과 본문 인용 안에서 확인되는 정보만 사용하십시오. 외부 지식·추측·일반 상식으로 작품 내용을 보충하지 마십시오. 단, 어휘의 사전적 의미(옛말·방언 등)는 간단히 덧붙일 수 있습니다.",
    "2. 근거에서 확인되지 않는 내용을 질문받으면 정확히 \"작품에서 확인되지 않음\"이라고 답하십시오.",
    blocking
      ? "3. 독자는 아직 작품을 읽는 중입니다. 제공된 근거는 이미 독자의 현재 위치 이전 것만 선별되었습니다. 이후 전개·결말을 암시하거나 언급하지 마십시오."
      : "3. 이 작품은 비순차 정보형으로 전역 조회가 허용됩니다.",
    "4. 답변은 한국어로, 2~5문장 이내로 간결하게. 근거로 쓴 인용이 있으면 어느 부분에서 확인되는지 자연스럽게 언급하십시오.",
  ].join("\n");
}

function buildEvidenceBlock(r: RetrievalResult): string {
  const lines: string[] = [];
  if (r.glossaryMatches.length) {
    lines.push("[근거 — 글로서리]");
    for (const g of r.glossaryMatches) {
      lines.push(`- (${g.type}) ${g.name}${g.aliases.length ? ` (별칭: ${g.aliases.join(", ")})` : ""}: ${g.description}`);
    }
  }
  if (r.evidenceSegments.length) {
    lines.push("", "[근거 — 본문 인용]");
    r.evidenceSegments.forEach((s, i) => {
      lines.push(`(${i + 1}) [${s.paraIdx + 1}번째 문단, 오프셋 ${s.startOffset}] ${s.text.slice(0, 300)}`);
    });
  }
  if (!lines.length) lines.push("[근거 없음 — 글로서리 매칭 및 본문 검색 결과가 없습니다]");
  return lines.join("\n");
}

export async function explain(
  work: Work,
  selectionText: string,
  unit: SelectionUnit,
  selectionOffset: number,
  readingPosition: number,
  spoilerBlock: boolean
): Promise<ExplainResponse> {
  const r = await retrieve(work, selectionText, selectionOffset, unit, readingPosition, spoilerBlock);
  const blocking = spoilerBlock && work.type === "sequential";
  const llm = getLLM();

  const contextText = r.contextSegments.map((s) => s.text).join("\n").slice(0, 1500);
  const grounded = r.glossaryMatches.length > 0 || r.evidenceSegments.length > 0;

  let explanation: string;
  if (!llm.available) {
    // LLM 키 미설정 폴백: 글로서리 설명 그대로 카드에 표시
    explanation = grounded
      ? r.glossaryMatches.map((g) => `${g.name}: ${g.description}`).join("\n\n") ||
        "관련 본문 근거를 찾았습니다. 아래 근거 인용을 확인하세요. (LLM API 키 미설정 — .env.local을 채우면 생성 해설이 표시됩니다)"
      : "작품에서 확인되지 않음";
  } else {
    const userMsg = [
      buildEvidenceBlock(r),
      "",
      `[독자가 선택한 ${unit === "word" ? "단어" : unit === "sentence" ? "문장" : "문단"}]`,
      `"${selectionText}"`,
      "",
      "[선택 위치 주변 문맥]",
      contextText || "(문맥 없음)",
      "",
      "위 근거만 사용해 선택 부분을 해설해 주세요.",
    ].join("\n");
    explanation = await llm.complete({
      system: buildSystemPrompt(work, blocking),
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 700,
    });
  }

  return {
    explanation: explanation.trim(),
    grounded,
    citations: r.evidenceSegments.map((s) => toCitation(s)),
    glossaryCards: r.glossaryMatches.map(toCard),
    spoilerFiltered: r.spoilerFiltered,
    unit,
    model: llm.available ? `${llm.name}/${llm.model}` : "fallback(글로서리 직표시)",
  };
}

export async function chatAnswer(
  work: Work,
  history: LLMMessage[],
  message: string,
  selectionText: string | undefined,
  selectionOffset: number,
  readingPosition: number,
  spoilerBlock: boolean
): Promise<{ answer: string; citations: Citation[]; glossaryCards: GlossaryCard[]; spoilerFiltered: { segments: number; glossary: number } }> {
  // 질문 기준으로 근거 검색 재수행
  const query = selectionText ? `${selectionText} ${message}` : message;
  const r = await retrieve(work, query, selectionOffset, "sentence", readingPosition, spoilerBlock);
  const blocking = spoilerBlock && work.type === "sequential";
  const llm = getLLM();

  let answer: string;
  if (!llm.available) {
    answer =
      r.glossaryMatches.length || r.evidenceSegments.length
        ? "LLM 키가 설정되지 않아 후속 질문 응답을 생성할 수 없습니다. 아래 근거 인용을 참고하세요."
        : "작품에서 확인되지 않음";
  } else {
    const userMsg = [
      buildEvidenceBlock(r),
      "",
      selectionText ? `[원래 선택 부분] "${selectionText}"` : "",
      `[독자의 질문] ${message}`,
      "",
      "위 근거만 사용해 질문에 답해 주세요.",
    ].filter(Boolean).join("\n");
    answer = await llm.complete({
      system: buildSystemPrompt(work, blocking),
      messages: [...history.slice(-8), { role: "user", content: userMsg }],
      maxTokens: 700,
    });
  }

  return {
    answer: answer.trim(),
    citations: r.evidenceSegments.map((s) => toCitation(s)),
    glossaryCards: r.glossaryMatches.map(toCard),
    spoilerFiltered: r.spoilerFiltered,
  };
}
