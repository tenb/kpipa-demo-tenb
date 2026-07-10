import { NextResponse } from "next/server";
import { getGlossary, getWork } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  const work = getWork(id);
  if (!work) return NextResponse.json({ error: "작품 없음" }, { status: 404 });

  // 스포일러 차단: ?readingPosition= 지정 시 첫 등장 이전 항목만
  const url = new URL(req.url);
  const rp = url.searchParams.get("readingPosition");
  let entries = getGlossary(id);
  if (rp !== null && work.type === "sequential") {
    entries = entries.filter((g) => g.firstAppearanceOffset <= Number(rp));
  }
  return NextResponse.json(entries);
}
