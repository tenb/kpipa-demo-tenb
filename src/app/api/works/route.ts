import { NextRequest, NextResponse } from "next/server";
import {
  listWorks,
  saveWork,
  saveBuildStatus,
  getContentText,
  getWork,
} from "@/lib/store";
import { ensureSeed } from "@/lib/seed";
import { runBuildPipeline } from "@/lib/pipeline";
import type { Work, WorkFormat, WorkType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  await ensureSeed();
  return NextResponse.json(listWorks());
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 필드가 필요합니다" }, { status: 400 });
  }
  const type = (form.get("type") as WorkType) === "reference" ? "reference" : "sequential";
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const format: WorkFormat = ext === "epub" ? "epub" : ext === "pdf" ? "pdf" : "txt";
  const title =
    (form.get("title") as string)?.trim() ||
    file.name.replace(/\.(txt|epub|pdf)$/i, "");

  const workId = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const work: Work = {
    id: workId,
    title,
    type,
    format,
    createdAt: new Date().toISOString(),
    textLength: 0,
  };
  saveWork(work);
  saveBuildStatus({ workId, phase: "대기", done: false, logs: [] });

  const buf = Buffer.from(await file.arrayBuffer());
  // 비동기 구축 — 진행 상황은 /api/works/:id/status 폴링
  void runBuildPipeline(work, buf).then(() => {
    const w = getWork(workId);
    if (w) {
      w.textLength = getContentText(workId).length;
      saveWork(w);
    }
  });

  return NextResponse.json({ workId });
}
