import { and, eq } from "drizzle-orm";
import { db, providers, models } from "@/lib/db";
import { guard } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { fetchModels, friendlyError, type Kind } from "@/lib/providers";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  await db().delete(providers).where(eq(providers.id, id));
  return Response.json({ ok: true });
}

/** Tes koneksi + segarkan daftar model. */
export async function POST(_: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  const [p] = await db().select().from(providers).where(eq(providers.id, id));
  if (!p) return Response.json({ error: "Provider tidak ditemukan" }, { status: 404 });
  try {
    const remote = await fetchModels({ kind: p.kind as Kind, name: p.name, baseUrl: p.baseUrl, apiKey: decrypt(p.keyEnc) });
    const existing = await db().select({ modelId: models.modelId }).from(models).where(eq(models.providerId, id));
    const have = new Set(existing.map((m) => m.modelId));
    const fresh = remote.filter((m) => !have.has(m.id));
    if (fresh.length)
      await db()
        .insert(models)
        .values(fresh.map((m) => ({ providerId: id, modelId: m.id, label: m.label })));
    await db().update(providers).set({ status: "ok" }).where(eq(providers.id, id));
    return Response.json({ ok: true, added: fresh.length });
  } catch (e) {
    await db().update(providers).set({ status: "error" }).where(and(eq(providers.id, id)));
    return Response.json({ ok: false, error: friendlyError(e) }, { status: 200 });
  }
}
