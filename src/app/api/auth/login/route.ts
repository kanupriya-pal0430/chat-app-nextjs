import { NextRequest, NextResponse } from "next/server";
import {
  logIn,
  sessionCookieOptions,
  COOKIE_NAME,
  validMutationOrigin,
} from "@/lib/server/auth";
import { z } from "zod";
export const runtime = "nodejs";
const schema = z
  .object({
    name: z.string().min(1).max(100),
    password: z.string().min(1).max(256),
  })
  .strict();
export async function POST(request: NextRequest) {
  if (!validMutationOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  const token = await logIn(parsed.data.name, parsed.data.password);
  if (!token)
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
