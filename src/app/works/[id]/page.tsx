"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  Work,
  Segment,
  ExplainResponse,
  SelectionUnit,
  Citation,
  ChatMessage,
} from "@/lib/types";

const UNIT_LABEL: Record<SelectionUnit, string> = {
  word: "단어",
  sentence: "문장",
  paragraph: "문단",
};

interface PanelState {
  status: "idle" | "loading" | "done" | "error";
  selectionText: string;
  unit: SelectionUnit;
  offset: number;
  response?: ExplainResponse;
  error?: string;
}

export default function ViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [work, setWork] = useState<Work | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [readingPosition, setReadingPosition] = useState(0);
  const [spoilerBlock, setSpoilerBlock] = useState(true);
  const [evalMode, setEvalMode] = useState(false);
  const [evalCount, setEvalCount] = useState(0);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const readingPosRef = useRef(0);
  const textLength = work?.textLength || segments[segments.length - 1]?.endOffset || 1;

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/works/${id}/content`);
      if (!res.ok) return;
      const json = await res.json();
      setWork(json.work);
      setSegments(json.segments);
      if (json.work.type === "reference") setSpoilerBlock(false);
    })();
    fetch(`/api/works/${id}/eval`)
      .then((r) => r.json())
      .then((log) => setEvalCount(Array.isArray(log) ? log.length : 0))
      .catch(() => {});
  }, [id]);

  // 읽기 위치 추적 (스크롤 최하단 가시 문단의 endOffset, 전진만)
  useEffect(() => {
    function onScroll() {
      const container = bodyRef.current;
      if (!container) return;
      const limit = window.scrollY + window.innerHeight * 0.85;
      let pos = readingPosRef.current;
      for (const p of container.querySelectorAll<HTMLElement>("[data-end]")) {
        const top = p.getBoundingClientRect().top + window.scrollY;
        if (top < limit) pos = Math.max(pos, Number(p.dataset.end));
      }
      if (pos !== readingPosRef.current) {
        readingPosRef.current = pos;
        setReadingPosition(pos);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [segments.length]);

  const detectUnit = useCallback(
    (text: string, paraCount: number, paraLen: number): SelectionUnit => {
      if (paraCount > 1 || text.includes("\n")) return "paragraph";
      const t = text.trim();
      // 단어: 짧고(≤15자) 문장부호 없음 — "김 첨지"처럼 공백 1개까지 허용
      if (t.length <= 15 && !/[.!?…,]/.test(t) && (t.match(/\s/g) ?? []).length <= 1)
        return "word";
      if (paraLen > 0 && t.length >= paraLen * 0.85) return "paragraph";
      return "sentence";
    },
    []
  );

  const explainSelection = useCallback(
    async (text: string, unit: SelectionUnit, offset: number) => {
      setPanel({ status: "loading", selectionText: text, unit, offset });
      setChatMessages([]);
      sessionIdRef.current = null;
      try {
        const res = await fetch(`/api/works/${id}/explain`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selection: { text, offset },
            unit,
            readingPosition: readingPosRef.current,
            spoilerBlock,
            evalMode,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "해설 생성 실패");
        setPanel({
          status: "done",
          selectionText: text,
          unit: json.unit,
          offset,
          response: json,
        });
        if (evalMode) setEvalCount((c) => c + 1);
      } catch (err) {
        setPanel({
          status: "error",
          selectionText: text,
          unit,
          offset,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [id, spoilerBlock, evalMode]
  );

  // 선택 핸들러 (더블클릭 단어 선택 포함 — mouseup으로 통합 처리)
  useEffect(() => {
    function onMouseUp() {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = sel.toString().trim();
        if (!text || text.length < 1 || text.length > 1200) return;
        const range = sel.getRangeAt(0);
        const container = bodyRef.current;
        if (!container || !container.contains(range.startContainer)) return;

        const startEl =
          range.startContainer instanceof Element
            ? range.startContainer.closest("[data-start]")
            : range.startContainer.parentElement?.closest("[data-start]");
        const endEl =
          range.endContainer instanceof Element
            ? range.endContainer.closest("[data-start]")
            : range.endContainer.parentElement?.closest("[data-start]");
        if (!startEl) return;

        const segStart = Number((startEl as HTMLElement).dataset.start);
        const localOffset =
          range.startContainer.nodeType === Node.TEXT_NODE ? range.startOffset : 0;
        const offset = segStart + localOffset;
        const paraCount = startEl === endEl || !endEl ? 1 : 2;
        const paraLen = (startEl.textContent ?? "").length;
        const unit = detectUnit(text, paraCount, paraLen);
        explainSelection(text, unit, offset);
      }, 10);
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [detectUnit, explainSelection]);

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || !panel) return;
    setChatInput("");
    setChatLoading(true);
    setChatMessages((m) => [
      ...m,
      { role: "user", content: message, ts: new Date().toISOString() },
    ]);
    try {
      if (!sessionIdRef.current) {
        sessionIdRef.current = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      }
      const res = await fetch(`/api/works/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message,
          readingPosition: readingPosRef.current,
          spoilerBlock,
          selectionText: panel.selectionText,
          selectionOffset: panel.offset,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "응답 실패");
      setChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: json.answer,
          ts: new Date().toISOString(),
          citations: json.citations,
        },
      ]);
    } catch (err) {
      setChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `오류: ${err instanceof Error ? err.message : String(err)}`,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function scrollToCitation(c: Citation) {
    const el = bodyRef.current?.querySelector(`[data-seg="${c.segmentId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("para-highlight");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("para-highlight");
    }
  }

  const progress = Math.min(100, Math.round((readingPosition / textLength) * 100));

  if (!work) {
    return <main className="p-10 text-neutral-500">불러오는 중…</main>;
  }

  return (
    <div className="min-h-screen">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-(--paper)/95 backdrop-blur px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <Link href="/" className="text-sm text-neutral-500 hover:text-(--accent) shrink-0">
            ← 서재
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">
              {work.title}
              {work.author && (
                <span className="ml-2 text-sm font-normal text-neutral-500">{work.author}</span>
              )}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm shrink-0">
            <span className="text-neutral-500 log-line">
              읽은 위치 {progress}% · {readingPosition.toLocaleString()}자
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer" title="순차 감상형: 현재 위치 이후 본문·글로서리를 검색에서 제외">
              <input
                type="checkbox"
                checked={spoilerBlock}
                onChange={(e) => setSpoilerBlock(e.target.checked)}
              />
              <span className={spoilerBlock ? "font-medium text-(--accent)" : "text-neutral-500"}>
                스포일러 차단
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" title="선택→응답을 eval_log에 자동 기록 (증빙 3)">
              <input
                type="checkbox"
                checked={evalMode}
                onChange={(e) => setEvalMode(e.target.checked)}
              />
              <span className={evalMode ? "font-medium text-(--accent)" : "text-neutral-500"}>
                평가 모드{evalCount ? ` (${evalCount})` : ""}
              </span>
            </label>
            {evalCount > 0 && (
              <a href={`/api/works/${id}/eval?format=csv`} className="text-neutral-500 underline">
                CSV
              </a>
            )}
            <Link href={`/works/${id}/glossary`} className="text-neutral-500 hover:text-(--accent)">
              글로서리
            </Link>
            <Link href={`/works/${id}/build`} className="text-neutral-500 hover:text-(--accent)">
              구축 로그
            </Link>
          </div>
        </div>
        {/* 진행률 바 + 읽기 위치 수동 조절 */}
        <div className="mx-auto mt-2 max-w-6xl flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded bg-neutral-200 overflow-hidden">
            <div className="h-full bg-(--accent) transition-all" style={{ width: `${progress}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={textLength}
            value={readingPosition}
            onChange={(e) => {
              const v = Number(e.target.value);
              readingPosRef.current = v;
              setReadingPosition(v);
            }}
            className="w-40 accent-(--accent)"
            title="읽기 위치 수동 설정 (스포일러 차단 데모용)"
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-10">
        {/* 본문 */}
        <main className="reading-body min-w-0 flex-1 max-w-2xl" ref={bodyRef}>
          <h2 className="mb-10 text-3xl font-semibold">{work.title}</h2>
          {segments.map((s) => (
            <p
              key={s.id}
              data-seg={s.id}
              data-start={s.startOffset}
              data-end={s.endOffset}
              className="mb-6"
            >
              {s.text}
            </p>
          ))}
          <p className="mt-16 mb-24 text-center text-sm text-neutral-400 font-sans">
            — 끝 · 단어는 더블클릭, 문장·문단은 드래그하면 해설이 표시됩니다 —
          </p>
        </main>

        {/* 해설 패널 */}
        <aside className="hidden w-96 shrink-0 lg:block">
          <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto">
            {!panel && (
              <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 leading-relaxed">
                본문에서 <strong>단어를 더블클릭</strong>하거나{" "}
                <strong>문장·문단을 드래그</strong>하면
                작품 지식베이스에서 근거를 찾아 해설합니다.
                <br />
                <br />
                해설은 글로서리 + 검색된 본문 구간 안에서만 생성되며, 근거가
                없으면 &ldquo;작품에서 확인되지 않음&rdquo;으로 표시됩니다.
              </div>
            )}
            {panel && (
              <ExplainCard
                panel={panel}
                chatMessages={chatMessages}
                chatInput={chatInput}
                chatLoading={chatLoading}
                onChatInput={setChatInput}
                onChatSubmit={sendChat}
                onCitationClick={scrollToCitation}
                onClose={() => setPanel(null)}
              />
            )}
          </div>
        </aside>
      </div>

      {/* 모바일 하단 시트 */}
      {panel && (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto border-t border-neutral-200 bg-white p-4 shadow-2xl lg:hidden">
          <ExplainCard
            panel={panel}
            chatMessages={chatMessages}
            chatInput={chatInput}
            chatLoading={chatLoading}
            onChatInput={setChatInput}
            onChatSubmit={sendChat}
            onCitationClick={scrollToCitation}
            onClose={() => setPanel(null)}
          />
        </div>
      )}
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = {
  인물: "bg-amber-100 text-amber-800",
  용어: "bg-sky-100 text-sky-800",
  사건: "bg-rose-100 text-rose-800",
  설정: "bg-emerald-100 text-emerald-800",
};

function ExplainCard({
  panel,
  chatMessages,
  chatInput,
  chatLoading,
  onChatInput,
  onChatSubmit,
  onCitationClick,
  onClose,
}: {
  panel: PanelState;
  chatMessages: ChatMessage[];
  chatInput: string;
  chatLoading: boolean;
  onChatInput: (v: string) => void;
  onChatSubmit: (e: React.FormEvent) => void;
  onCitationClick: (c: Citation) => void;
  onClose: () => void;
}) {
  const r = panel.response;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-100 px-5 py-3">
        <div className="min-w-0">
          <span className="mr-2 rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-white align-middle">
            {UNIT_LABEL[panel.unit]}
          </span>
          <span className="text-sm font-semibold break-all">
            “{panel.selectionText.length > 60 ? panel.selectionText.slice(0, 60) + "…" : panel.selectionText}”
          </span>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 shrink-0">
          ✕
        </button>
      </div>

      <div className="px-5 py-4 space-y-4 text-[0.95rem] leading-relaxed">
        {panel.status === "loading" && (
          <p className="text-neutral-500">
            <span className="pulse-dot">●</span> 지식베이스에서 근거 검색 후 해설 생성 중…
          </p>
        )}
        {panel.status === "error" && (
          <p className="text-red-600 text-sm">{panel.error}</p>
        )}

        {r && (
          <>
            {/* 글로서리 카드 */}
            {r.glossaryCards.map((g) => (
              <div key={g.id} className="rounded-lg bg-neutral-50 border border-neutral-200 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_COLOR[g.type] ?? "bg-neutral-100"}`}>
                    {g.type}
                  </span>
                  <span className="font-bold">{g.name}</span>
                  {g.aliases.length > 0 && (
                    <span className="text-xs text-neutral-500">({g.aliases.join(", ")})</span>
                  )}
                </div>
                <p className="text-sm text-neutral-700">{g.description}</p>
                <p className="mt-1 text-xs text-neutral-400 log-line">
                  첫 등장 오프셋 {g.firstAppearanceOffset.toLocaleString()} · 언급 {g.mentionCount}회
                </p>
              </div>
            ))}

            {/* 해설 본문 */}
            <div className="whitespace-pre-wrap">{r.explanation}</div>

            {/* 스포일러 차단 알림 */}
            {(r.spoilerFiltered.segments > 0 || r.spoilerFiltered.glossary > 0) && (
              <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                🔒 스포일러 차단: 현재 읽기 위치 이후의 본문 {r.spoilerFiltered.segments}개 구간
                {r.spoilerFiltered.glossary > 0 && ` · 글로서리 ${r.spoilerFiltered.glossary}개 항목`}
                이 검색에서 제외되었습니다.
              </p>
            )}

            {/* 근거 인용 */}
            {r.citations.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  근거 인용 ({r.citations.length})
                </p>
                <div className="space-y-2">
                  {r.citations.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => onCitationClick(c)}
                      className="block w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs text-neutral-600 hover:border-(--accent)"
                    >
                      <span className="text-neutral-800">“{c.quote}”</span>
                      <span className="mt-1 block text-neutral-400 log-line">
                        {c.paraIdx + 1}번째 문단 · 오프셋 {c.offset.toLocaleString()} — 클릭하여 이동
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="border-t border-neutral-100 pt-2 text-[10px] text-neutral-400">
              {r.grounded && "✓ 근거 제한 생성 · "}
              {r.model}
            </p>

            {/* 후속 질문 채팅 */}
            <div className="border-t border-neutral-100 pt-3">
              {chatMessages.length > 0 && (
                <div className="mb-3 space-y-2">
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-(--accent)/10 ml-6"
                          : "bg-neutral-50 border border-neutral-200 mr-2"
                      }`}
                    >
                      {m.content}
                      {m.citations && m.citations.length > 0 && (
                        <span className="mt-1 block text-xs text-neutral-400">
                          근거 {m.citations.length}건
                        </span>
                      )}
                    </div>
                  ))}
                  {chatLoading && (
                    <p className="text-sm text-neutral-400">
                      <span className="pulse-dot">●</span> 근거 재검색 중…
                    </p>
                  )}
                </div>
              )}
              <form onSubmit={onChatSubmit} className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => onChatInput(e.target.value)}
                  placeholder="이어서 질문하기 (예: 이 인물은 왜 이렇게 행동했나요?)"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-(--accent) focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  className="rounded-lg bg-(--ink) px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  전송
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
