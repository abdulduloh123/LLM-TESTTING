import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, settings, loginAttempts } from "@/lib/db";
import { createSession, destroySession, hasSession } from "@/lib/session";

const body = z.object({
  action: z.enum(["setup", "login", "logout"]),
  password: z.string().max(200).optional(),
  setupToken: z.string().max(200).optional(),
});

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 40; // menahan tebakan terdistribusi dari banyak IP

async function getHash() {
  const [row] = await db().select().from(settings).where(eq(settings.key, "password_hash"));
  return row?.value ?? null;
}

/** IP klien. Di Vercel, header x-vercel-forwarded-for / x-forwarded-for diisi platform dan tidak bisa dipalsukan klien. */
function clientIp(req: Request) {
  const h = req.headers;
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET() {
  const hash = await getHash();
  return Response.json({
    setup: !!hash,
    authed: await hasSession(),
    // Opsional: bila SETUP_TOKEN diatur di env, pembuatan password pertama wajib memakainya.
    needsSetupToken: !hash && !!process.env.SETUP_TOKEN,
  });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Permintaan tidak valid" }, { status: 400 });
  const { action, password = "", setupToken = "" } = parsed.data;

  if (action === "logout") {
    await destroySession();
    return Response.json({ ok: true });
  }

  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MS);
  const [[mine], [all]] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(loginAttempts).where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.at, since))),
    db().select({ n: sql<number>`count(*)::int` }).from(loginAttempts).where(gt(loginAttempts.at, since)),
  ]);
  if (mine.n >= PER_IP_LIMIT || all.n >= GLOBAL_LIMIT)
    return Response.json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." }, { status: 429 });

  const fail = async (msg: string, status: number) => {
    await db().insert(loginAttempts).values({ ip });
    // bersihkan catatan lama agar tabel tidak membengkak
    await db().delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return Response.json({ error: msg }, { status });
  };

  const hash = await getHash();

  if (action === "setup") {
    if (hash) return Response.json({ error: "Password sudah dibuat" }, { status: 409 });
    const required = process.env.SETUP_TOKEN;
    if (required && !sameSecret(setupToken, required)) return fail("Kode setup salah", 403);
    if (password.length < 8) return Response.json({ error: "Password minimal 8 karakter" }, { status: 400 });
    // onConflictDoNothing: bila dua permintaan setup berbarengan, hanya satu yang menang.
    const created = await db()
      .insert(settings)
      .values({ key: "password_hash", value: await bcrypt.hash(password, 12) })
      .onConflictDoNothing()
      .returning({ key: settings.key });
    if (!created.length) return Response.json({ error: "Password sudah dibuat" }, { status: 409 });
    await createSession();
    return Response.json({ ok: true });
  }

  // Selalu jalankan bcrypt (hash tiruan bila belum ada password) agar waktu respons seragam.
  const ok = await bcrypt.compare(password, hash ?? "$2b$12$fGkkr70Nvh4NkH96.KJG6uBRgsPnK9/yaFwCYwjQHLWBAnHA.A5aC");
  if (!hash || !ok) return fail("Password salah", 401);
  await db().delete(loginAttempts).where(eq(loginAttempts.ip, ip));
  await createSession();
  return Response.json({ ok: true });
}
