import { cookies } from "next/headers";
import { parse as parseCookies } from "cookie";
import { createHash, randomBytes } from "node:crypto";
import { compare } from "bcryptjs";
import { database, getLoginUser, publicUser } from "./db";
import type { User } from "@/lib/shared/types";
import { redirect } from "next/navigation";

export const COOKIE_NAME = "relay_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const tokenHash = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");

export function userForToken(raw: string | undefined): User | null {
  if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null;
  const session = database()
    .prepare("SELECT userId FROM sessions WHERE tokenHash=? AND expiresAt>?")
    .get(tokenHash(raw), new Date().toISOString()) as
    | { userId: string }
    | undefined;
  return session ? publicUser(session.userId) : null;
}
export function userForCookieHeader(header: string | undefined): User | null {
  const value = parseCookies(header || "")[COOKIE_NAME];
  return userForToken(value);
}
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  return userForToken(jar.get(COOKIE_NAME)?.value);
}
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
export async function logIn(
  name: string,
  password: string
): Promise<string | null> {
  const row = getLoginUser(name);
  if (!row || !(await compare(password, row.passwordHash))) return null;
  const token = randomBytes(32).toString("hex");
  database()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(
      tokenHash(token),
      row.id,
      new Date(Date.now() + SESSION_DURATION).toISOString()
    );
  return token;
}
export function logOut(token: string | undefined) {
  if (token)
    database()
      .prepare("DELETE FROM sessions WHERE tokenHash=?")
      .run(tokenHash(token));
}
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION / 1000,
};
export function validMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    // Respect the configured origin when behind a trusted reverse proxy.
    const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}
