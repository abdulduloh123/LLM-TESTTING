import { after } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db, providers, conversations } from "@/lib/db";
import { guard } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { friendlyError, makeModel, type Kind } from "@/lib/providers";
import { loadPrefs } from "@/lib/prefs";
import { activeSystem } from "@/lib/prefs-schema";
import { loadMessages, saveMessages } from "@/lib/messages";
import { forModel, sanitizeUserParts, textOf, type MsgMeta } from "@/lib/message-utils";
import { trimToBudget } from "@/lib/context";

export const maxDuration = 300;

const DEFAULT_TITLE = "Percakapan baru";

// Klien hanya mengirim pesan terbaru + daftar id riwayat; isi riwayat dibaca dari database.
// (Menjaga ukuran request kecil dan jauh di bawah batas 4,5 MB Vercel, terutama bila ada gambar.)
const bodySchema = z.object({
  id: z.string().uuid(), // id percakapan
  providerId: z.string().uuid(),
  modelId: z.string().min(1),
  historyCount: z.number().int().min(0).max(5000).optional(), // jumlah pesan sebelum pesan terbaru
  history: z.array(z.string().max(100)).max(5000).optional(), // klien lama: id; hanya jumlahnya yang dipakai
  message: z.object({ id: z.string().min(1).max(100), role: z.enum(["user", "assistant"]), parts: z.array(z.any()) }).optional(),
  // bentuk lama (klien lama yang masih ter-cache): seluruh riwayat dikirim
  messages: z.array(z.any()).min(1).optional(),
});

async function makeTitle(model: ReturnType<typeof makeModel>, user: string, assistant: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      instructions:
        "Buat judul percakapan yang sangat singkat (maksimal 6 kata) dalam bahasa yang dipakai pengguna. Balas hanya judulnya, tanpa tanda kutip atau titik.",
      prompt: `Pengguna: ${user.slice(0, 600)}\n\nAsisten: ${assistant.slice(0, 600)}`,
      maxOutputTokens: 200,
      abortSignal: AbortSignal.timeout(20_000),
    });
    const t = text.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").replace(/\s+/g, " ").slice(0, 60);
    return t || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.message && !parsed.data.messages))
    return Response.json({ error: "Permintaan tidak valid" }, { status: 400 });
  const { id, providerId, modelId, historyCount, history, message } = parsed.data;

  const [[p], [conv], prefs, stored] = await Promise.all([
    db().select().from(providers).where(eq(providers.id, providerId)),
    db().select({ id: conversations.id, title: conversations.title }).from(conversations).where(eq(conversations.id, id)),
    loadPrefs(),
    message ? loadMessages(id) : Promise.resolve([] as UIMessage[]),
  ]);
  if (!p) return Response.json({ error: "Provider tidak ditemukan. Pilih model lain." }, { status: 404 });
  if (!conv) return Response.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });

  // Susun riwayat lengkap.
  let incoming: UIMessage[];
  if (message) {
    // Riwayat = N pesan pertama di database (urut posisi). Tidak bergantung pada id dari klien,
    // sehingga id yang berbeda antara klien dan server tidak lagi membuat riwayat "tidak sinkron".
    const n = historyCount ?? history?.length ?? 0;
    if (stored.length < n)
      return Response.json({ error: "Riwayat tidak sinkron. Buka ulang percakapan lalu coba lagi." }, { status: 409 });
    const prior = stored.slice(0, n);
    const byId = new Map(stored.map((m) => [m.id, m]));
    const last: UIMessage =
      message.role === "user"
        ? { id: message.id, role: "user", parts: sanitizeUserParts(message.parts) }
        : (byId.get(message.id) ?? { id: message.id, role: "assistant", parts: [] });
    incoming = [...prior, last];
  } else {
    incoming = (parsed.data.messages as UIMessage[]).map((m) =>
      m.role === "user" ? { ...m, parts: sanitizeUserParts(m.parts) } : m,
    );
  }
  const first = incoming.find((m) => m.role === "user");
  if (!incoming.length || incoming[incoming.length - 1].parts.length === 0)
    return Response.json({ error: "Pesan kosong" }, { status: 400 });

  // Simpan pesan pengguna lebih dulu agar tidak hilang bila streaming gagal.
  const provisionalTitle = first ? textOf(first).trim().slice(0, 60) || DEFAULT_TITLE : DEFAULT_TITLE;
  const isNew = conv.title === DEFAULT_TITLE;
  await Promise.all([
    saveMessages(id, incoming, modelId),
    db()
      .update(conversations)
      .set({ providerId, modelId, updatedAt: sql`now()`, ...(isNew ? { title: provisionalTitle } : {}) })
      .where(eq(conversations.id, id)),
  ]);

  const model = makeModel({ kind: p.kind as Kind, name: p.name, baseUrl: p.baseUrl, apiKey: decrypt(p.keyEnc) }, modelId);

  // Pangkas riwayat lama agar tidak melewati batas konteks.
  const { messages: forSend } = trimToBudget(forModel(incoming), prefs.contextTokens);

  const result = streamText({
    model,
    instructions: activeSystem(prefs),
    messages: await convertToModelMessages(forSend),
    temperature: prefs.temperature ?? undefined,
    maxOutputTokens: prefs.maxTokens ?? undefined,
    abortSignal: req.signal,
  });

  // Judul otomatis dibuat di latar belakang setelah balasan pertama selesai.
  let finish!: (v: { messages: UIMessage[]; ok: boolean }) => void;
  const finished = new Promise<{ messages: UIMessage[]; ok: boolean }>((r) => (finish = r));
  if (prefs.autoTitle && isNew) {
    after(async () => {
      const { messages: all, ok } = await finished;
      if (!ok) return;
      const user = all.find((m) => m.role === "user");
      const asst = [...all].reverse().find((m) => m.role === "assistant");
      if (!user || !asst || !textOf(asst).trim()) return;
      const title = await makeTitle(model, textOf(user), textOf(asst));
      if (title)
        await db()
          .update(conversations)
          .set({ title })
          .where(and(eq(conversations.id, id), eq(conversations.title, provisionalTitle)));
    });
  }

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: incoming,
      // Wajib: tanpa ini balasan asisten tersimpan dengan id kosong dan bentrok di database.
      generateMessageId: () => crypto.randomUUID(),
      messageMetadata: ({ part }): MsgMeta | undefined => {
        if (part.type === "start") return { model: modelId };
        if (part.type === "finish")
          return { model: modelId, usage: { in: part.totalUsage.inputTokens, out: part.totalUsage.outputTokens } };
      },
      onError: (e) => friendlyError(e),
      onEnd: async ({ messages: all, outcome }) => {
        try {
          await saveMessages(id, all as UIMessage[], modelId);
          await db().update(conversations).set({ updatedAt: sql`now()` }).where(eq(conversations.id, id));
        } catch (e) {
          console.error("gagal menyimpan balasan", e);
        } finally {
          finish({ messages: all as UIMessage[], ok: outcome.status === "completed" });
        }
      },
    }),
  });
}
