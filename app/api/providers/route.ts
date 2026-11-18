import { desc } from "drizzle-orm";
import { z } from "zod";
import { db, providers, models } from "@/lib/db";
import { guard } from "@/lib/session";
import { encrypt } from "@/lib/crypto";
import { PRESETS, fetchModels, friendlyError } from "@/lib/providers";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const rows = await db().select().from(providers).orderBy(desc(providers.createdAt));
  return Response.json(
    rows.map((p) => ({
      id: p.id,
      preset: p.preset,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      keyLast4: p.keyLast4,
      status: p.status,
    })),
  );
}

const create = z.object({
  preset: z.string(),
  name: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(8).max(500),
  baseUrl: z.string().trim().url().optional(),
});

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Isian belum lengkap atau tidak valid" }, { status: 400 });
  const { preset, name, apiKey } = parsed.data;
  const def = PRESETS[preset];
  if (!def) return Response.json({ error: "Preset tidak dikenal" }, { status: 400 });
  const baseUrl = def.baseUrl ?? parsed.data.baseUrl ?? null;
  if (def.kind === "openai-compatible" && !baseUrl)
    return Response.json({ error: "Base URL wajib untuk provider kustom" }, { status: 400 });
  if (baseUrl && !/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl))
    return Response.json({ error: "Base URL harus https" }, { status: 400 });

  const cfg = { kind: def.kind, name, baseUrl, apiKey };
  let remote: { id: string; label: string }[] = [];
  let status = "ok";
  try {
    remote = await fetchModels(cfg);
  } catch (e) {
    status = "error";
    // Provider tanpa endpoint /models tetap boleh disimpan (model diisi manual),
    // tetapi key yang ditolak tidak disimpan.
    const msg = friendlyError(e);
    if (msg.startsWith("Key ditolak")) return Response.json({ error: msg }, { status: 400 });
    status = "unknown";
  }

  const [p] = await db()
    .insert(providers)
    .values({ kind: def.kind, preset, name, baseUrl, keyEnc: encrypt(apiKey), keyLast4: apiKey.slice(-4), status })
    .returning({ id: providers.id });
  if (remote.length)
    await db()
      .insert(models)
      .values(remote.map((m) => ({ providerId: p.id, modelId: m.id, label: m.label })));
  return Response.json({ id: p.id, status, modelCount: remote.length });
}
