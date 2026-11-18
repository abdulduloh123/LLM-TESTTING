import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessage } from "ai";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, providers, conversations, messages } from "@/lib/db";
import { guard } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { friendlyError, makeModel, type Kind } from "@/lib/providers";

export const maxDuration = 300;

const bodySchema = z.object({
  id: z.string().uuid(), // id percakapan
  messages: z.array(z.any()).min(1),
  providerId: z.string().uuid(),
  modelId: z.string().min(1),
  system: z.string().max(20000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
});

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

async function save(convId: string, list: UIMessage[], fallbackModel: string) {
  const rows = list.map((m, i) => ({
    id: m.id,
    conversationId: convId,
    position: i,
    role: m.role,
    parts: m.parts,
    text: textOf(m),
    model: m.role === "assistant" ? ((m.metadata as { model?: string } | undefined)?.model ?? fallbackModel) : null,
  }));
  await db().delete(messages).where(eq(messages.conversationId, convId));
  if (rows.length) await db().insert(messages).values(rows);
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Permintaan tidak valid" }, { status: 400 });
  const { id, providerId, modelId, system, temperature, maxTokens } = parsed.data;
  const incoming = parsed.data.messages as UIMessage[];

  const [p] = await db().select().from(providers).where(eq(providers.id, providerId));
  if (!p) return Response.json({ error: "Provider tidak ditemukan. Pilih model lain." }, { status: 404 });
  const [conv] = await db().select({ id: conversations.id, title: conversations.title }).from(conversations).where(eq(conversations.id, id));
  if (!conv) return Response.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });

  // Simpan pesan pengguna lebih dulu agar tidak hilang bila streaming gagal.
  const first = incoming.find((m) => m.role === "user");
  await save(id, incoming, modelId);
  await db()
    .update(conversations)
    .set({
      providerId,
      modelId,
      updatedAt: sql`now()`,
      ...(conv.title === "Percakapan baru" && first ? { title: (textOf(first).trim().slice(0, 60) || "Percakapan baru") } : {}),
    })
    .where(eq(conversations.id, id));

  const model = makeModel({ kind: p.kind as Kind, name: p.name, baseUrl: p.baseUrl, apiKey: decrypt(p.keyEnc) }, modelId);

  const result = streamText({
    model,
    instructions: system || undefined,
    messages: await convertToModelMessages(incoming),
    temperature,
    maxOutputTokens: maxTokens,
    abortSignal: req.signal,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: incoming,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { model: modelId };
      },
      onError: (e) => friendlyError(e),
      onEnd: async ({ messages: all }) => {
        await save(id, all as UIMessage[], modelId);
        await db().update(conversations).set({ updatedAt: sql`now()` }).where(eq(conversations.id, id));
      },
    }),
  });
}
