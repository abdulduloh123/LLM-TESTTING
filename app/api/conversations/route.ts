import { desc, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, conversations, messages } from "@/lib/db";
import { guard } from "@/lib/session";

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await db()
      .select({
        id: conversations.id,
        title: conversations.title,
        pinned: conversations.pinned,
        updatedAt: conversations.updatedAt,
        snippet: sql<string | null>`(select substring(m.text from greatest(position(lower(${q}) in lower(m.text)) - 30, 1) for 120) from messages m where m.conversation_id = ${conversations.id} and m.text ilike ${like} limit 1)`,
      })
      .from(conversations)
      .where(
        or(
          ilike(conversations.title, like),
          sql`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.text ilike ${like})`,
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    return Response.json(rows);
  }
  const rows = await db()
    .select({
      id: conversations.id,
      title: conversations.title,
      pinned: conversations.pinned,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .limit(200);
  return Response.json(rows);
}

const create = z.object({ providerId: z.string().uuid().nullable().optional(), modelId: z.string().nullable().optional() });

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = create.safeParse(await req.json().catch(() => ({})));
  const d = parsed.success ? parsed.data : {};
  const [c] = await db()
    .insert(conversations)
    .values({ providerId: d.providerId ?? null, modelId: d.modelId ?? null })
    .returning({ id: conversations.id });
  return Response.json(c);
}

/** Hapus semua data percakapan. */
export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;
  await db().delete(conversations).where(sql`true`);
  return Response.json({ ok: true });
}

