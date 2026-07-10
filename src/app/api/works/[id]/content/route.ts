import { NextResponse } from "next/server";
import { getSegments, getWork } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  const work = getWork(id);
  if (!work) return NextResponse.json({ error: "작품 없음" }, { status: 404 });
  return NextResponse.json({ work, segments: getSegments(id) });
}
