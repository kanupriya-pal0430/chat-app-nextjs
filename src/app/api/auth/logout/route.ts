import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, logOut, validMutationOrigin } from "@/lib/server/auth";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!validMutationOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  logOut(request.cookies.get(COOKIE_NAME)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
