import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, conversations } from "@/lib/db";
import { loadMessages } from "@/lib/messages";
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
  return Response.json({ ...c, messages: await loadMessages(id) });
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
