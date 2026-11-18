import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, conversations, messages } from "@/lib/db";
import { guard } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();

export async function GET(_: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const [c] = await db().select().from(conversations).where(eq(conversations.id, id));
  if (!c) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const rows = await db().select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.position));
  return Response.json({
    ...c,
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      metadata: { model: m.model },
    })),
  });
}

const patch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  providerId: z.string().uuid().nullable().optional(),
  modelId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !uuid.safeParse(id).success) return Response.json({ error: "Tidak valid" }, { status: 400 });
  await db().update(conversations).set(parsed.data).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "Tidak valid" }, { status: 400 });
  await db().delete(conversations).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}
