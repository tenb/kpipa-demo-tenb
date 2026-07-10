"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { GlossaryEntry, GlossaryType, Work } from "@/lib/types";

const TYPES: GlossaryType[] = ["인물", "용어", "사건", "설정"];

const TYPE_COLOR: Record<string, string> = {
  인물: "bg-amber-100 text-amber-800 border-amber-200",
  용어: "bg-sky-100 text-sky-800 border-sky-200",
  사건: "bg-rose-100 text-rose-800 border-rose-200",
  설정: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function GlossaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [work, setWork] = useState<Work | null>(null);
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [tab, setTab] = useState<GlossaryType | "전체">("전체");

  useEffect(() => {
    fetch(`/api/works/${id}/content`)
      .then((r) => r.json())
      .then((j) => setWork(j.work))
      .catch(() => {});
    fetch(`/api/works/${id}/glossary`)
      .then((r) => r.json())
      .then((j) => Array.isArray(j) && setEntries(j))
      .catch(() => {});
  }, [id]);

  const filtered = tab === "전체" ? entries : entries.filter((e) => e.type === tab);
  const counts = Object.fromEntries(
    TYPES.map((t) => [t, entries.filter((e) => e.type === t).length])
  );
  const textLength = work?.textLength || 1;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <Link href={`/works/${id}`} className="text-sm text-neutral-500 hover:text-(--accent)">
          ← 뷰어로 돌아가기
        </Link>
        <h1 className="mt-2 text-3xl font-bold">
          글로서리 <span className="text-neutral-400 font-normal">· {work?.title ?? ""}</span>
        </h1>
        <p className="mt-2 text-neutral-600">
          업로드된 작품에서 자동 추출·병합된 지식베이스 항목 {entries.length}건.
          각 항목은 본문 명시 정보만으로 작성되며, 첫 등장 위치를 기준으로
          스포일러 차단에 사용됩니다.
        </p>
      </header>

      {/* 유형 탭 */}
      <div className="mb-6 flex gap-2">
        {(["전체", ...TYPES] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border transition ${
              tab === t
                ? "bg-(--ink) text-white border-(--ink)"
                : "bg-white text-neutral-600 border-neutral-300 hover:border-neutral-500"
            }`}
          >
            {t}
            <span className="ml-1.5 text-xs opacity-70">
              {t === "전체" ? entries.length : counts[t]}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((e) => (
          <div key={e.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[e.type]}`}>
                {e.type}
              </span>
              <h2 className="text-lg font-bold">{e.name}</h2>
            </div>
            {e.aliases.length > 0 && (
              <p className="mb-2 text-xs text-neutral-500">
                별칭: {e.aliases.join(" · ")}
              </p>
            )}
            <p className="text-sm leading-relaxed text-neutral-700">{e.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-xs text-neutral-400 log-line">
              <span>
                첫 등장 {Math.round((e.firstAppearanceOffset / textLength) * 100)}% 지점
                (오프셋 {e.firstAppearanceOffset.toLocaleString()})
              </span>
              <span>언급 {e.mentionOffsets.length}회</span>
              <span>근거 세그먼트 {e.evidenceSegmentIds.length}개</span>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <p className="text-neutral-500 col-span-2">
            {entries.length === 0
              ? "글로서리가 비어 있습니다. LLM API 키 설정 후 구축 로그 화면에서 재구축하세요."
              : "해당 유형의 항목이 없습니다."}
          </p>
        )}
      </div>
    </main>
  );
}
