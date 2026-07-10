"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Work } from "@/lib/types";

export default function HomePage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [workType, setWorkType] = useState<"sequential" | "reference">("sequential");

  const load = useCallback(async () => {
    const res = await fetch("/api/works");
    if (res.ok) setWorks(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", workType);
      const res = await fetch("/api/works", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "업로드 실패");
      window.location.href = `/works/${json.workId}/build`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header className="mb-12">
        <p className="text-sm font-medium tracking-wide text-(--accent) mb-2">
          KPIPA 2026 출판콘텐츠 기술개발 · 프로토타입 (TRL 4)
        </p>
        <h1 className="text-4xl font-bold leading-snug">
          작품 맥락 해설 eBook 뷰어
        </h1>
        <p className="mt-4 text-lg text-neutral-600 leading-relaxed">
          책을 업로드하면 글로서리(인물·용어·사건·설정)를 자동 추출해 작품별
          지식베이스를 만들고, 본문에서 선택한 단어·문장·문단을{" "}
          <strong>작품 원문 근거가 있는 해설만</strong>으로 설명합니다.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">서재</h2>
        <div className="space-y-3">
          {works.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm"
            >
              <div>
                <Link
                  href={`/works/${w.id}`}
                  className="text-lg font-semibold hover:text-(--accent)"
                >
                  {w.title}
                </Link>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {w.author ? `${w.author} · ` : ""}
                  {w.format.toUpperCase()} ·{" "}
                  {w.type === "sequential" ? "순차 감상형 (스포일러 차단)" : "비순차 정보형"}
                  {w.textLength ? ` · ${w.textLength.toLocaleString()}자` : ""}
                  {w.preloaded ? " · 프리로드" : ""}
                </p>
              </div>
              <div className="flex gap-2 text-sm shrink-0">
                <Link href={`/works/${w.id}`} className="rounded-lg bg-(--accent) px-3 py-1.5 text-white">
                  열람
                </Link>
                <Link href={`/works/${w.id}/glossary`} className="rounded-lg border border-neutral-300 px-3 py-1.5">
                  글로서리
                </Link>
                <Link href={`/works/${w.id}/build`} className="rounded-lg border border-neutral-300 px-3 py-1.5">
                  구축 로그
                </Link>
              </div>
            </div>
          ))}
          {!works.length && (
            <p className="text-neutral-500">불러오는 중…</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">새 작품 업로드</h2>
        <form
          onSubmit={handleUpload}
          className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.epub,.pdf"
            className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-4 file:py-2 file:font-medium"
          />
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={workType === "sequential"}
                onChange={() => setWorkType("sequential")}
              />
              순차 감상형 (소설 — 스포일러 차단 ON)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={workType === "reference"}
                onChange={() => setWorkType("reference")}
              />
              비순차 정보형 (전역 조회)
            </label>
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-(--ink) px-5 py-2.5 text-white font-medium disabled:opacity-50"
          >
            {uploading ? "업로드 중…" : "업로드 → 지식베이스 구축"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-neutral-500">
            EPUB / TXT / PDF 지원. 업로드 즉시 파싱 → 글로서리 추출 → 임베딩 인덱싱이
            진행되며 구축 로그 화면으로 이동합니다.
          </p>
        </form>
      </section>
    </main>
  );
}
