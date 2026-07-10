import { NextRequest, NextResponse } from "next/server";
import { getEvalLog, clearEvalLog } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";

export const runtime = "nodejs";

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  const log = getEvalLog(id);
  const url = new URL(req.url);

  if (url.searchParams.get("format") === "csv") {
    const header = "no,selected_text,unit,type,response_summary,verdict,timestamp";
    const rows = log.map((r) =>
      [r.no, r.selected_text, r.unit, r.type, r.response_summary, r.verdict, r.timestamp]
        .map((v) => csvEscape(String(v)))
        .join(",")
    );
    const bom = "﻿"; // Excel 한글 호환
    return new NextResponse(bom + [header, ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="eval_log_${id}.csv"`,
      },
    });
  }
  return NextResponse.json(log);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  clearEvalLog(id);
  return NextResponse.json({ ok: true });
}
