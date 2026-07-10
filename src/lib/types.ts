export type WorkType = "sequential" | "reference";
export type WorkFormat = "epub" | "txt" | "pdf";

export interface Work {
  id: string;
  title: string;
  author?: string;
  type: WorkType; // sequential: 스포일러 차단 ON / reference: 전역 조회
  format: WorkFormat;
  createdAt: string;
  textLength: number;
  preloaded?: boolean;
}

export interface Segment {
  id: string;
  workId: string;
  chapterIdx: number;
  paraIdx: number;
  startOffset: number; // 작품 전체 기준 문자 위치
  endOffset: number;
  text: string;
}

export type GlossaryType = "인물" | "용어" | "사건" | "설정";

export interface GlossaryEntry {
  id: string;
  workId: string;
  type: GlossaryType;
  name: string;
  aliases: string[];
  description: string; // 스포일러 없는 기본 설명 (첫 등장 시점 기준)
  firstAppearanceOffset: number;
  mentionOffsets: number[];
  evidenceSegmentIds: string[];
}

export type BuildPhase =
  | "대기"
  | "파싱"
  | "글로서리 추출"
  | "병합"
  | "임베딩 인덱싱"
  | "완료"
  | "오류";

export interface BuildLogLine {
  ts: string;
  phase: BuildPhase;
  message: string;
  level?: "info" | "warn" | "error";
}

export interface BuildStatus {
  workId: string;
  phase: BuildPhase;
  done: boolean;
  error?: string;
  logs: BuildLogLine[];
}

export type SelectionUnit = "word" | "sentence" | "paragraph";

export interface Citation {
  quote: string;
  chapterIdx: number;
  paraIdx: number;
  offset: number;
  segmentId: string;
}

export interface GlossaryCard {
  id: string;
  type: GlossaryType;
  name: string;
  aliases: string[];
  description: string;
  firstAppearanceOffset: number;
  mentionCount: number;
}

export interface ExplainResponse {
  explanation: string;
  grounded: boolean; // 근거가 있었는지
  citations: Citation[];
  glossaryCards: GlossaryCard[];
  spoilerFiltered: { segments: number; glossary: number };
  unit: SelectionUnit;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  citations?: Citation[];
}

export interface ChatSession {
  id: string;
  workId: string;
  selectionText?: string;
  selectionOffset?: number;
  messages: ChatMessage[];
}

export interface EvalRecord {
  no: number;
  selected_text: string;
  unit: SelectionUnit;
  type: string; // 인물/용어/사건/설정/기타
  response_summary: string;
  verdict: string; // 공란 = 사람이 판정
  timestamp: string;
}
