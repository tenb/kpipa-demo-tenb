import fs from "fs";
import path from "path";
import type {
  Work,
  Segment,
  GlossaryEntry,
  BuildStatus,
  BuildLogLine,
  BuildPhase,
  ChatSession,
  EvalRecord,
} from "./types";

const DATA_ROOT = path.join(process.cwd(), "data");

export function workDir(workId: string) {
  return path.join(DATA_ROOT, workId);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1), "utf8");
}

// ── Work ──────────────────────────────────────────────
export function listWorks(): Work[] {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs
    .readdirSync(DATA_ROOT)
    .map((id) => readJson<Work>(path.join(DATA_ROOT, id, "work.json")))
    .filter((w): w is Work => !!w)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getWork(workId: string): Work | null {
  return readJson<Work>(path.join(workDir(workId), "work.json"));
}

export function saveWork(work: Work) {
  writeJson(path.join(workDir(work.id), "work.json"), work);
}

// ── 원문/세그먼트/글로서리 ─────────────────────────────
export function saveContentText(workId: string, text: string) {
  fs.mkdirSync(workDir(workId), { recursive: true });
  fs.writeFileSync(path.join(workDir(workId), "content.txt"), text, "utf8");
}

export function getContentText(workId: string): string {
  try {
    return fs.readFileSync(path.join(workDir(workId), "content.txt"), "utf8");
  } catch {
    return "";
  }
}

export function saveSegments(workId: string, segments: Segment[]) {
  writeJson(path.join(workDir(workId), "segments.json"), segments);
}

export function getSegments(workId: string): Segment[] {
  return readJson<Segment[]>(path.join(workDir(workId), "segments.json")) ?? [];
}

export function saveGlossary(workId: string, entries: GlossaryEntry[]) {
  writeJson(path.join(workDir(workId), "glossary.json"), entries);
}

export function getGlossary(workId: string): GlossaryEntry[] {
  return (
    readJson<GlossaryEntry[]>(path.join(workDir(workId), "glossary.json")) ?? []
  );
}

// ── 임베딩 ─────────────────────────────────────────────
export interface EmbeddingIndex {
  provider: string;
  model: string;
  dim: number;
  segments: Record<string, number[]>;
  glossary: Record<string, number[]>;
}

export function saveEmbeddings(workId: string, index: EmbeddingIndex) {
  writeJson(path.join(workDir(workId), "embeddings.json"), index);
}

export function getEmbeddings(workId: string): EmbeddingIndex | null {
  return readJson<EmbeddingIndex>(path.join(workDir(workId), "embeddings.json"));
}

// ── 구축 상태/로그 ─────────────────────────────────────
export function getBuildStatus(workId: string): BuildStatus {
  return (
    readJson<BuildStatus>(path.join(workDir(workId), "build.json")) ?? {
      workId,
      phase: "대기",
      done: false,
      logs: [],
    }
  );
}

export function saveBuildStatus(status: BuildStatus) {
  writeJson(path.join(workDir(status.workId), "build.json"), status);
}

export function appendBuildLog(
  workId: string,
  phase: BuildPhase,
  message: string,
  level: BuildLogLine["level"] = "info"
) {
  const status = getBuildStatus(workId);
  status.phase = phase;
  status.logs.push({ ts: new Date().toISOString(), phase, message, level });
  if (phase === "완료") status.done = true;
  if (phase === "오류") {
    status.done = true;
    status.error = message;
  }
  saveBuildStatus(status);
}

// ── 채팅 세션 ──────────────────────────────────────────
export function getChatSession(
  workId: string,
  sessionId: string
): ChatSession | null {
  return readJson<ChatSession>(
    path.join(workDir(workId), "chats", `${sessionId}.json`)
  );
}

export function saveChatSession(session: ChatSession) {
  writeJson(
    path.join(workDir(session.workId), "chats", `${session.id}.json`),
    session
  );
}

// ── 자체평가 로그 ──────────────────────────────────────
export function getEvalLog(workId: string): EvalRecord[] {
  return (
    readJson<EvalRecord[]>(path.join(workDir(workId), "eval_log.json")) ?? []
  );
}

export function appendEvalRecord(
  workId: string,
  record: Omit<EvalRecord, "no">
) {
  const log = getEvalLog(workId);
  log.push({ no: log.length + 1, ...record });
  writeJson(path.join(workDir(workId), "eval_log.json"), log);
  return log.length;
}

export function clearEvalLog(workId: string) {
  writeJson(path.join(workDir(workId), "eval_log.json"), []);
}
