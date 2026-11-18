import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const COOKIE = "session";

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET minimal 32 karakter");
  return new TextEncoder().encode(s);
};

export async function createSession() {
  const token = await new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function hasSession(): Promise<boolean> {
  try {
    const t = (await cookies()).get(COOKIE)?.value;
    if (!t) return false;
    await jwtVerify(t, secret());
    return true;
  } catch {
    return false;
  }
}

/** Untuk Route Handler: kembalikan Response 401 bila tak ada sesi. */
export async function guard(): Promise<Response | null> {
  return (await hasSession()) ? null : Response.json({ error: "Belum masuk" }, { status: 401 });
}
