"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BuildStatus, BuildPhase } from "@/lib/types";

const PHASES: BuildPhase[] = ["파싱", "글로서리 추출", "병합", "임베딩 인덱싱", "완료"];

export default function BuildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/api/works/${id}/status`);
        if (res.ok) {
          const s: BuildStatus = await res.json();
          setStatus(s);
          if (s.done) return; // 완료 시 폴링 종료
        }
      } catch {}
      if (!stop) setTimeout(poll, 1000);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [id, rebuilding]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [status?.logs.length]);

  async function rebuild() {
    if (!confirm("저장된 원문으로 파이프라인을 재실행합니다. 기존 글로서리·인덱스를 덮어씁니다. 계속할까요?")) return;
    await fetch(`/api/works/${id}/rebuild`, { method: "POST" });
    setRebuilding((v) => !v); // 폴링 재시작 트리거
  }

  const phaseIdx = status ? PHASES.indexOf(status.phase as BuildPhase) : -1;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <Link href={`/works/${id}`} className="text-sm text-neutral-500 hover:text-(--accent)">
          ← 뷰어로 돌아가기
        </Link>
        <h1 className="mt-2 text-3xl font-bold">지식베이스 구축 과정</h1>
        <p className="mt-2 text-neutral-600">
          파싱 → 글로서리 추출(LLM) → 병합 → 임베딩 인덱싱 단계별 진행 로그.
        </p>
      </header>

      {/* 단계 스테퍼 */}
      <div className="mb-8 flex items-center gap-1">
        {PHASES.map((p, i) => {
          const isDone = status?.done ? i <= phaseIdx : i < phaseIdx;
          const active = !status?.done && i === phaseIdx;
          const isError = status?.phase === "오류";
          return (
            <div key={p} className="flex flex-1 items-center gap-1">
              <div
                className={`flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-medium border ${
                  isError && active
                    ? "bg-red-50 border-red-300 text-red-700"
                    : isDone
                    ? "bg-(--accent) border-(--accent) text-white"
                    : active
                    ? "bg-amber-50 border-(--accent) text-(--accent)"
                    : "bg-white border-neutral-200 text-neutral-400"
                }`}
              >
                {isDone ? "✓ " : active ? <span className="pulse-dot">● </span> : ""}
                {p}
              </div>
              {i < PHASES.length - 1 && <span className="text-neutral-300">→</span>}
            </div>
          );
        })}
      </div>

      {/* 로그 */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 font-mono text-[0.83rem] leading-relaxed text-neutral-200 max-h-[28rem] overflow-y-auto">
        {status?.logs.map((l, i) => (
          <div key={i} className="log-line flex gap-3">
            <span className="text-neutral-500 shrink-0">
              {new Date(l.ts).toLocaleTimeString("ko-KR", { hour12: false })}
            </span>
            <span
              className={`shrink-0 w-28 ${
                l.level === "error"
                  ? "text-red-400"
                  : l.level === "warn"
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              [{l.phase}]
            </span>
            <span className={l.level === "error" ? "text-red-300" : ""}>{l.message}</span>
          </div>
        ))}
        {!status?.logs.length && <p className="text-neutral-500">로그 없음</p>}
        {status && !status.done && (
          <p className="mt-1 text-neutral-400">
            <span className="pulse-dot">●</span> 진행 중…
          </p>
        )}
        <div ref={logEndRef} />
      </div>

      <div className="mt-6 flex items-center gap-3">
        {status?.done && !status.error && (
          <Link
            href={`/works/${id}`}
            className="rounded-lg bg-(--accent) px-5 py-2.5 font-medium text-white"
          >
            뷰어에서 열람 →
          </Link>
        )}
        <Link
          href={`/works/${id}/glossary`}
          className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium"
        >
          글로서리 결과 보기
        </Link>
        <button
          onClick={rebuild}
          className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium text-neutral-600 hover:border-neutral-500"
          title="LLM 키 설정 후 실제 추출 파이프라인을 다시 실행"
        >
          ⟳ 재구축 (LLM 추출 재실행)
        </button>
      </div>
    </main>
  );
}
