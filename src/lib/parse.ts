// 파일 파싱 → 정규화 텍스트 + Segment 목록 (전역 문자 오프셋 좌표계)
//
// 좌표계 규칙: content.txt에 저장되는 정규화 텍스트가 유일한 기준.
// 문단은 "\n\n"으로 구분되며 Segment.startOffset/endOffset은 이 텍스트 기준 문자 인덱스.

import type { Segment, WorkFormat } from "./types";

export interface ParsedChapter {
  title?: string;
  paragraphs: string[];
}

export interface ParseResult {
  text: string; // 정규화된 전체 텍스트 (오프셋 기준)
  segments: Segment[];
  chapterCount: number;
}

/** 챕터/문단 배열 → 전역 오프셋 부여 */
export function buildSegments(workId: string, chapters: ParsedChapter[]): ParseResult {
  const segments: Segment[] = [];
  let offset = 0;
  const parts: string[] = [];
  chapters.forEach((ch, chapterIdx) => {
    ch.paragraphs.forEach((para, paraIdx) => {
      const text = para.trim();
      if (!text) return;
      if (parts.length > 0) offset += 2; // "\n\n" 구분자
      segments.push({
        id: `s-${chapterIdx}-${paraIdx}`,
        workId,
        chapterIdx,
        paraIdx,
        startOffset: offset,
        endOffset: offset + text.length,
        text,
      });
      parts.push(text);
      offset += text.length;
    });
  });
  return { text: parts.join("\n\n"), segments, chapterCount: chapters.length };
}

export function parseTxt(workId: string, raw: string): ParseResult {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/﻿/g, "");
  const paragraphs = normalized
    .split(/\n\s*\n|\n(?=\S)/) // 빈 줄 또는 줄바꿈 기준 분리
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return buildSegments(workId, [{ paragraphs }]);
}

function htmlToParagraphs(html: string): string[] {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const blocks = body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(p|div|h[1-6]|li|br)[^>]*>/gi, "\n\n<>")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return blocks
    .split(/\n\s*\n/)
    .map((p) => p.replace(/<>/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

export async function parseEpub(workId: string, buf: Buffer): Promise<ParseResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);

  // OPF 찾기 → spine 순서대로 챕터 추출
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = containerXml?.match(/full-path="([^"]+)"/)?.[1];
  const chapters: ParsedChapter[] = [];

  if (opfPath) {
    const opf = (await zip.file(opfPath)?.async("string")) ?? "";
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const manifest = new Map<string, string>();
    for (const m of opf.matchAll(/<item\s[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"[^>]*?\/?>(?:<\/item>)?/g)) {
      manifest.set(m[1], m[2]);
    }
    const spineIds = [...opf.matchAll(/<itemref\s[^>]*?idref="([^"]+)"/g)].map((m) => m[1]);
    for (const id of spineIds) {
      const href = manifest.get(id);
      if (!href || !/x?html?$/i.test(href)) continue;
      const file = zip.file(decodeURIComponent(opfDir + href)) ?? zip.file(opfDir + href);
      if (!file) continue;
      const html = await file.async("string");
      const paragraphs = htmlToParagraphs(html);
      if (paragraphs.length) chapters.push({ paragraphs });
    }
  }

  if (!chapters.length) {
    // fallback: zip 내 모든 html
    const htmlFiles = Object.keys(zip.files).filter((f) => /\.x?html?$/i.test(f)).sort();
    for (const f of htmlFiles) {
      const html = await zip.file(f)!.async("string");
      const paragraphs = htmlToParagraphs(html);
      if (paragraphs.length) chapters.push({ paragraphs });
    }
  }
  return buildSegments(workId, chapters);
}

export async function parsePdf(workId: string, buf: Buffer): Promise<ParseResult> {
  // pdf-parse의 디버그 하네스를 피하기 위해 내부 모듈 직접 로드
  const mod = await import("pdf-parse/lib/pdf-parse.js" as string);
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return parseTxt(workId, text);
}

export async function parseFile(
  workId: string,
  format: WorkFormat,
  buf: Buffer
): Promise<ParseResult> {
  if (format === "epub") return parseEpub(workId, buf);
  if (format === "pdf") return parsePdf(workId, buf);
  return parseTxt(workId, buf.toString("utf8"));
}
