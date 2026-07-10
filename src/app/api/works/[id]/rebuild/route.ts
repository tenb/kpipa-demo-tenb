import { NextResponse } from "next/server";
import { getWork, getContentText, saveBuildStatus } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";
import { runBuildPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";

/** 저장된 원문으로 파이프라인 재실행 (LLM 키 설정 후 실제 추출 데모용) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  const work = getWork(id);
  if (!work) return NextResponse.json({ error: "작품 없음" }, { status: 404 });
  const text = getContentText(id);
  if (!text) return NextResponse.json({ error: "원문 없음" }, { status: 400 });

  saveBuildStatus({ workId: id, phase: "대기", done: false, logs: [] });
  void runBuildPipeline({ ...work, format: "txt" }, Buffer.from(text, "utf8"));
  return NextResponse.json({ ok: true });
}
