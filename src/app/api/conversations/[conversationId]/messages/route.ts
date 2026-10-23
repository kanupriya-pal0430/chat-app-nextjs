import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getConversationMessages, isMember } from "@/lib/server/db";
import { idSchema } from "@/lib/shared/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await context.params;
  if (
    !idSchema.safeParse(conversationId).success ||
    !isMember(user.id, conversationId)
  )
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = request.nextUrl.searchParams.get("after");
  if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    return NextResponse.json(
      { error: "Invalid sequence cursor" },
      { status: 400 }
    );
  const after = Number(raw);
  const rows = getConversationMessages(conversationId, after, 101);
  return NextResponse.json(
    { messages: rows.slice(0, 100), hasMore: rows.length > 100 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
