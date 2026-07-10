import { NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/store";
import { ensureSeed } from "@/lib/seed";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureSeed();
  const { id } = await params;
  return NextResponse.json(getBuildStatus(id));
}
