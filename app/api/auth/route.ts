import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, settings, loginAttempts } from "@/lib/db";
import { createSession, destroySession, hasSession } from "@/lib/session";

const body = z.object({
  action: z.enum(["setup", "login", "logout"]),
  password: z.string().max(200).optional(),
});

async function getHash() {
  const [row] = await db().select().from(settings).where(eq(settings.key, "password_hash"));
  return row?.value ?? null;
}

export async function GET() {
  const hash = await getHash();
  return Response.json({ setup: !!hash, authed: await hasSession() });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Permintaan tidak valid" }, { status: 400 });
  const { action, password = "" } = parsed.data;

  if (action === "logout") {
    await destroySession();
    return Response.json({ ok: true });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.at, since)));
  if (n >= 5) return Response.json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." }, { status: 429 });

  const hash = await getHash();

  if (action === "setup") {
    if (hash) return Response.json({ error: "Password sudah dibuat" }, { status: 409 });
    if (password.length < 8) return Response.json({ error: "Password minimal 8 karakter" }, { status: 400 });
    await db().insert(settings).values({ key: "password_hash", value: await bcrypt.hash(password, 12) });
    await createSession();
    return Response.json({ ok: true });
  }

  if (!hash || !(await bcrypt.compare(password, hash))) {
    await db().insert(loginAttempts).values({ ip });
    return Response.json({ error: "Password salah" }, { status: 401 });
  }
  await createSession();
  return Response.json({ ok: true });
}
