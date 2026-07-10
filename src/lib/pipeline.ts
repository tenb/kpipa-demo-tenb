// 업로드 → 지식베이스 구축 파이프라인 (파싱 → 글로서리 추출 → 병합 → 임베딩)

import type { Work, Segment, GlossaryEntry, GlossaryType } from "./types";
import {
  saveContentText,
  saveSegments,
  saveGlossary,
  saveEmbeddings,
  appendBuildLog,
  saveBuildStatus,
  getContentText,
} from "./store";
import { parseFile } from "./parse";
import { getLLM } from "./llm";
import { getEmbedder } from "./embed";
import { findMentionOffsets, normalizeName } from "./korean";

const CHUNK_SIZE = 9000;

interface RawEntry {
  type: string;
  name: string;
  aliases?: string[];
  description?: string;
}

function extractJsonArray(text: string): RawEntry[] {
  // LLM 응답에서 JSON 배열만 추출
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const VALID_TYPES: GlossaryType[] = ["인물", "용어", "사건", "설정"];

const EXTRACT_SYSTEM = [
  "당신은 문학 작품에서 글로서리(인물·용어·사건·설정)를 추출하는 도구입니다.",
  "규칙:",
  "1. 본문에 명시된 정보만 사용하십시오. 추측·외부 지식 금지.",
  "2. description은 해당 항목이 처음 등장한 시점 기준으로, 이후 전개(스포일러)를 포함하지 않게 작성하십시오.",
  "3. aliases에는 본문에 실제로 등장하는 호칭 변형(별명·직함·존칭·줄임말)을 넣으십시오.",
  '4. 출력은 JSON 배열만: [{"type":"인물|용어|사건|설정","name":"...","aliases":["..."],"description":"..."}]',
].join("\n");

/** 이름/별칭 겹침 기준 병합 */
export function mergeEntries(chunks: RawEntry[][]): RawEntry[] {
  const merged: (RawEntry & { keys: Set<string> })[] = [];
  for (const chunk of chunks) {
    for (const e of chunk) {
      if (!e?.name || !VALID_TYPES.includes(e.type as GlossaryType)) continue;
      const keys = new Set(
        [e.name, ...(e.aliases ?? [])].map(normalizeName).filter(Boolean)
      );
      const hit = merged.find(
        (m) => m.type === e.type && [...keys].some((k) => m.keys.has(k))
      );
      if (hit) {
        for (const k of keys) hit.keys.add(k);
        const aliasSet = new Set([...(hit.aliases ?? []), ...(e.aliases ?? [])]);
        aliasSet.delete(hit.name);
        hit.aliases = [...aliasSet];
        // 더 짧은(스포일러 위험 낮은, 첫 등장 기준) 설명 유지 — 첫 청크 설명 우선
      } else {
        merged.push({ ...e, aliases: e.aliases ?? [], keys });
      }
    }
  }
  return merged.map(({ keys: _keys, ...e }) => e);
}

/** 오프셋·근거 세그먼트 계산 */
export function materializeEntries(
  workId: string,
  raw: RawEntry[],
  text: string,
  segments: Segment[]
): GlossaryEntry[] {
  return raw
    .map((e, i) => {
      const names = [e.name, ...(e.aliases ?? [])];
      const mentions = findMentionOffsets(text, names);
      const first = mentions.length ? mentions[0] : 0;
      const evidenceIds = new Set<string>();
      for (const off of mentions.slice(0, 8)) {
        const seg = segments.find((s) => off >= s.startOffset && off <= s.endOffset);
        if (seg) evidenceIds.add(seg.id);
        if (evidenceIds.size >= 4) break;
      }
      return {
        id: `g-${i}`,
        workId,
        type: e.type as GlossaryType,
        name: e.name,
        aliases: e.aliases ?? [],
        description: e.description ?? "",
        firstAppearanceOffset: first,
        mentionOffsets: mentions,
        evidenceSegmentIds: [...evidenceIds],
      };
    })
    .filter((e) => e.description);
}

export async function buildEmbeddingIndex(
  workId: string,
  segments: Segment[],
  glossary: GlossaryEntry[]
) {
  const embedder = getEmbedder();
  const segVecs = await embedder.embed(segments.map((s) => s.text));
  const gloVecs = glossary.length
    ? await embedder.embed(glossary.map((g) => `${g.name} ${g.description}`))
    : [];
  const index = {
    provider: embedder.name,
    model: embedder.model,
    dim: embedder.dim,
    segments: Object.fromEntries(segments.map((s, i) => [s.id, segVecs[i]])),
    glossary: Object.fromEntries(glossary.map((g, i) => [g.id, gloVecs[i]])),
  };
  saveEmbeddings(workId, index);
  return index;
}

/** 전체 구축 (비동기 실행, 진행 로그는 build.json에 기록 → status API로 폴링) */
export async function runBuildPipeline(work: Work, fileBuf: Buffer) {
  const workId = work.id;
  try {
    saveBuildStatus({ workId, phase: "파싱", done: false, logs: [] });
    appendBuildLog(workId, "파싱", `파일 수신: ${work.title} (${work.format.toUpperCase()}, ${(fileBuf.length / 1024).toFixed(1)}KB)`);

    // 1) 파싱
    const parsed = await parseFile(workId, work.format, fileBuf);
    saveContentText(workId, parsed.text);
    saveSegments(workId, parsed.segments);
    appendBuildLog(
      workId,
      "파싱",
      `파싱 완료: ${parsed.chapterCount}개 챕터, ${parsed.segments.length}개 문단 세그먼트, 총 ${parsed.text.length.toLocaleString()}자 (전역 오프셋 부여)`
    );

    // 2) 글로서리 추출 (청크 단위 LLM 호출)
    const llm = getLLM();
    let rawChunks: RawEntry[][] = [];
    if (!llm.available) {
      appendBuildLog(
        workId,
        "글로서리 추출",
        "LLM API 키 미설정 — 글로서리 추출을 건너뜁니다 (.env.local 설정 후 재업로드)",
        "warn"
      );
    } else {
      const chunks: { text: string; label: string }[] = [];
      let buf = "";
      let chunkStart = 0;
      for (const s of parsed.segments) {
        buf += (buf ? "\n\n" : "") + s.text;
        if (buf.length >= CHUNK_SIZE) {
          chunks.push({ text: buf, label: `${chunkStart.toLocaleString()}~${s.endOffset.toLocaleString()}자` });
          buf = "";
          chunkStart = s.endOffset;
        }
      }
      if (buf) chunks.push({ text: buf, label: `${chunkStart.toLocaleString()}자~끝` });
      appendBuildLog(workId, "글로서리 추출", `${chunks.length}개 청크로 분할 (${CHUNK_SIZE.toLocaleString()}자 기준) — 모델: ${llm.name}/${llm.model}`);

      for (let i = 0; i < chunks.length; i++) {
        appendBuildLog(workId, "글로서리 추출", `청크 ${i + 1}/${chunks.length} (${chunks[i].label}) 추출 중…`);
        const out = await llm.complete({
          system: EXTRACT_SYSTEM,
          messages: [{ role: "user", content: `다음 본문에서 글로서리를 추출하세요.\n\n${chunks[i].text}` }],
          maxTokens: 3000,
        });
        const entries = extractJsonArray(out);
        rawChunks.push(entries);
        appendBuildLog(workId, "글로서리 추출", `청크 ${i + 1}: ${entries.length}개 항목 추출`);
      }
    }

    // 3) 병합
    appendBuildLog(workId, "병합", "이름/별칭 기준 항목 병합 중…");
    const mergedRaw = mergeEntries(rawChunks);
    const glossary = materializeEntries(workId, mergedRaw, parsed.text, parsed.segments);
    saveGlossary(workId, glossary);
    const byType = glossary.reduce<Record<string, number>>((acc, g) => {
      acc[g.type] = (acc[g.type] ?? 0) + 1;
      return acc;
    }, {});
    appendBuildLog(
      workId,
      "병합",
      `병합 완료: ${glossary.length}개 항목 (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ") || "없음"}) — 언급 오프셋/첫 등장 위치 계산 완료`
    );

    // 4) 임베딩
    const embedder = getEmbedder();
    appendBuildLog(workId, "임베딩 인덱싱", `임베딩 인덱스 구축 중 — ${embedder.name}/${embedder.model} (${embedder.dim}차원)`);
    await buildEmbeddingIndex(workId, parsed.segments, glossary);
    appendBuildLog(
      workId,
      "임베딩 인덱싱",
      `인덱스 완료: 세그먼트 ${parsed.segments.length}건 + 글로서리 ${glossary.length}건 벡터화 (메모리 코사인 검색)`
    );

    appendBuildLog(workId, "완료", `지식베이스 구축 완료 — 뷰어에서 열람 가능`);
  } catch (err) {
    appendBuildLog(workId, "오류", err instanceof Error ? err.message : String(err), "error");
  }
}

export function rebuildEmbeddingsIfMissing(workId: string) {
  // 임베딩 provider 교체 시 대비용 훅 (데모에서는 seed 시 생성)
  void getContentText(workId);
}
