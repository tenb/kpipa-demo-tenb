import { NextRequest, NextResponse } from "next/server";
import { getWork, appendEvalRecord } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";
import { explain } from "@/lib/search";
import type { SelectionUnit } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  const work = getWork(id);
  if (!work) return NextResponse.json({ error: "작품 없음" }, { status: 404 });

  const body = await req.json();
  const selectionText: string = (body.selection?.text ?? body.selection ?? "").toString().trim();
  const unit: SelectionUnit = ["word", "sentence", "paragraph"].includes(body.unit)
    ? body.unit
    : "word";
  const selectionOffset: number = Number(body.selection?.offset ?? body.offset ?? 0);
  const readingPosition: number = Number(body.readingPosition ?? work.textLength);
  const spoilerBlock: boolean = body.spoilerBlock !== false;
  const evalMode: boolean = body.evalMode === true;

  if (!selectionText) {
    return NextResponse.json({ error: "selection.text가 필요합니다" }, { status: 400 });
  }

  try {
    const result = await explain(work, selectionText, unit, selectionOffset, readingPosition, spoilerBlock);

    if (evalMode) {
      const matchedType = result.glossaryCards[0]?.type ?? "기타";
      const summary = result.explanation.replace(/\s+/g, " ").slice(0, 100);
      appendEvalRecord(id, {
        selected_text: selectionText.slice(0, 60),
        unit,
        type: matchedType,
        response_summary: summary,
        verdict: "",
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
