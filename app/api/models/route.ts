import { eq, ne, and } from "drizzle-orm";
import { z } from "zod";
import { db, models, providers } from "@/lib/db";
import { guard } from "@/lib/session";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const rows = await db()
    .select({
      id: models.id,
      providerId: models.providerId,
      providerName: providers.name,
      modelId: models.modelId,
      label: models.label,
      favorite: models.favorite,
      isDefault: models.isDefault,
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id));
  return Response.json(rows);
}

const add = z.object({ providerId: z.string().uuid(), modelId: z.string().trim().min(1).max(200) });

/** Tambah model manual (untuk provider tanpa daftar model). */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = add.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tidak valid" }, { status: 400 });
  const { providerId, modelId } = parsed.data;
  const [dup] = await db()
    .select({ id: models.id })
    .from(models)
    .where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)));
  if (dup) return Response.json({ id: dup.id });
  const [m] = await db().insert(models).values({ providerId, modelId, label: modelId }).returning({ id: models.id });
  return Response.json({ id: m.id });
}

const patch = z.object({
  id: z.string().uuid(),
  favorite: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tidak valid" }, { status: 400 });
  const { id, favorite, isDefault } = parsed.data;
  if (isDefault) await db().update(models).set({ isDefault: false }).where(ne(models.id, id));
  const set: { favorite?: boolean; isDefault?: boolean } = {};
  if (favorite !== undefined) set.favorite = favorite;
  if (isDefault !== undefined) set.isDefault = isDefault;
  if (Object.keys(set).length) await db().update(models).set(set).where(eq(models.id, id));
  return Response.json({ ok: true });
}
