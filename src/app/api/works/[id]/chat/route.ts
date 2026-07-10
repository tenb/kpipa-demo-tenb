import { NextRequest, NextResponse } from "next/server";
import { getWork, getChatSession, saveChatSession } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";
import { chatAnswer } from "@/lib/search";
import type { ChatSession } from "@/lib/types";

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
  const sessionId: string = body.sessionId || `c-${Date.now().toString(36)}`;
  const message: string = (body.message ?? "").toString().trim();
  const readingPosition: number = Number(body.readingPosition ?? work.textLength);
  const spoilerBlock: boolean = body.spoilerBlock !== false;

  if (!message) {
    return NextResponse.json({ error: "message가 필요합니다" }, { status: 400 });
  }

  let session: ChatSession =
    getChatSession(id, sessionId) ?? {
      id: sessionId,
      workId: id,
      selectionText: body.selectionText,
      selectionOffset: body.selectionOffset,
      messages: [],
    };

  try {
    const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
    const result = await chatAnswer(
      work,
      history,
      message,
      session.selectionText,
      session.selectionOffset ?? 0,
      readingPosition,
      spoilerBlock
    );

    session.messages.push({ role: "user", content: message, ts: new Date().toISOString() });
    session.messages.push({
      role: "assistant",
      content: result.answer,
      ts: new Date().toISOString(),
      citations: result.citations,
    });
    saveChatSession(session);

    return NextResponse.json({ sessionId, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
