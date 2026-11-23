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
import { forModel, isImagePart, sanitizeUserParts, textOf, withImageDescriptions, limitOldImages, type MsgMeta } from "@/lib/message-utils";
import { describeImages } from "@/lib/vision";
import { generateImages, ImageGenError, parseDataUrl, type Img } from "@/lib/imagegen";
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
  // Mode pembuat gambar: Gemini membuat/mengedit gambar, model terpilih menulis balasan teksnya.
  image: z
    .object({
      mode: z.enum(["new", "edit"]),
      aspectRatio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]).optional(),
      count: z.number().int().min(1).max(4),
    })
    .optional(),
  // bentuk lama (klien lama yang masih ter-cache): seluruh riwayat dikirim
  messages: z.array(z.any()).min(1).optional(),
});

/** Sisipkan gambar buatan ke aliran balasan (setelah "start") agar ikut tersimpan sebagai bagian pesan asisten. */
function injectFiles<T extends { type: string }>(stream: ReadableStream<T>, files: Img[]): ReadableStream<T> {
  let done = false;
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(part, controller) {
        controller.enqueue(part);
        if (!done && part.type === "start") {
          done = true;
          for (const f of files) controller.enqueue({ type: "file", file: { mediaType: f.mediaType, base64: f.base64 } } as unknown as T);
        }
      },
    }),
  );
}

const IMAGE_HINT = (n: number) =>
  `Pengguna sedang memakai fitur pembuat gambar. ${n} gambar sudah dibuat oleh model gambar dari permintaan pengguna dan sudah tampil di chat; ` +
  "kamu tidak perlu dan tidak bisa membuat gambar sendiri, jadi jangan menolak atau berkata tidak bisa membuat gambar. " +
  "Balas singkat dalam bahasa pengguna: jelaskan ringkas apa yang dimaksud pada desain, lalu beri 2-3 ide variasi atau cara memperjelas deskripsinya.";

async function makeTitle(model: ReturnType<typeof makeModel>, user: string, assistant: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      instructions:
        "Buat judul percakapan yang sangat singkat (maksimal 6 kata) dalam bahasa yang dipakai pengguna. Balas hanya judulnya, tanpa tanda kutip atau titik.",
      prompt: `Pengguna: ${user.slice(0, 300)}\n\nAsisten: ${assistant.slice(0, 200)}`,
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
  const { id, providerId, modelId, historyCount, history, message, image: imageReq } = parsed.data;

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
    // Riwayat dicocokkan lewat id. Id yang tidak ada di database (mis. placeholder balasan yang gagal/kosong
    // di klien) dilewati begitu saja, bukan dianggap galat. Klien lama hanya mengirim jumlah (historyCount).
    const byId = new Map(stored.map((m) => [m.id, m]));
    let prior: UIMessage[];
    if (history) prior = history.map((hid) => byId.get(hid)).filter((m): m is UIMessage => !!m);
    else {
      const n = historyCount ?? 0;
      if (stored.length < n)
        return Response.json({ error: "Riwayat tidak sinkron. Buka ulang percakapan lalu coba lagi." }, { status: 409 });
      prior = stored.slice(0, n);
    }
    const last: UIMessage =
      message.role === "user"
        ? {
            id: message.id,
            role: "user",
            parts: sanitizeUserParts(message.parts),
            // pertahankan deskripsi gambar yang sudah tersimpan (mis. saat "Ulangi")
            ...(byId.get(message.id)?.metadata ? { metadata: byId.get(message.id)!.metadata } : {}),
          }
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

  // Pembaca gambar: bila model penglihatan diatur (dan berbeda dari model jawaban), gambar dibaca olehnya
  // dan model yang dipilih menjawab berdasarkan deskripsinya.
  const vision = prefs.visionModel;
  const useVision = !!vision && !(vision.providerId === providerId && vision.modelId === modelId);
  let visionError: string | null = null;
  const hasImages = incoming.some((m) => m.role === "user" && m.parts.some(isImagePart));

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

  // Mode pembuat gambar (Gemini). Gagal di sini = tidak ada balasan; pesan pengguna sudah tersimpan.
  let generated: Img[] = [];
  let imageMeta: MsgMeta = {};
  if (imageReq) {
    const im = prefs.imageModel;
    if (!im) return Response.json({ error: "Atur model pembuat gambar di Pengaturan terlebih dahulu." }, { status: 400 });
    const [ip] = await db().select().from(providers).where(eq(providers.id, im.providerId));
    if (!ip || ip.kind !== "google")
      return Response.json({ error: "Model pembuat gambar harus dari provider Google Gemini. Periksa Pengaturan." }, { status: 400 });
    const lastMsg = incoming[incoming.length - 1];
    const prompt = textOf(lastMsg).trim();
    if (!prompt) return Response.json({ error: "Tulis deskripsi gambar yang diinginkan." }, { status: 400 });

    // Gambar acuan: lampiran pada pesan ini; bila tidak ada dan mode "edit", gambar buatan terakhir.
    let refs = lastMsg.parts.flatMap((p) => (p.type === "file" ? [parseDataUrl(p.url)] : [])).filter((r): r is Img => !!r);
    if (!refs.length && imageReq.mode === "edit") {
      const prevAsst = [...incoming.slice(0, -1)].reverse().find((m) => m.role === "assistant" && m.parts.some((q) => q.type === "file"));
      const img = prevAsst?.parts.flatMap((q) => (q.type === "file" ? [parseDataUrl(q.url)] : [])).find((r) => r);
      if (img) refs = [img];
    }
    try {
      generated = await generateImages({
        apiKey: decrypt(ip.keyEnc),
        model: im.modelId,
        prompt,
        refs,
        aspectRatio: imageReq.aspectRatio,
        count: imageReq.count,
        signal: req.signal,
      });
    } catch (e) {
      const msg = e instanceof ImageGenError ? e.message : "Gagal membuat gambar. Coba lagi.";
      return Response.json({ error: msg }, { status: 502 });
    }
    imageMeta = { imagePrompt: prompt.slice(0, 500), imageModel: im.modelId };
  }

  let sendList = incoming;
  let visionActive = false;
  if (useVision && vision && hasImages && !imageReq) {
    const [vp] = await db().select().from(providers).where(eq(providers.id, vision.providerId));
    if (vp) {
      visionActive = true;
      try {
        const visionModel = makeModel({ kind: vp.kind as Kind, name: vp.name, baseUrl: vp.baseUrl, apiKey: decrypt(vp.keyEnc) }, vision.modelId);
        incoming = await describeImages(incoming, visionModel, req.signal);
      } catch (e) {
        visionError = friendlyError(e);
      }
    }
  }
  if (visionError)
    return Response.json({ error: `Model pembaca gambar gagal: ${visionError} Periksa model pembaca gambar di Pengaturan.` }, { status: 502 });
  sendList = limitOldImages(withImageDescriptions(incoming, visionActive || !!imageReq));

  // Pangkas riwayat lama agar tidak melewati batas konteks.
  const { messages: forSend } = trimToBudget(forModel(sendList), prefs.contextTokens);

  const result = streamText({
    model,
    instructions: [activeSystem(prefs), imageReq ? IMAGE_HINT(generated.length) : undefined].filter(Boolean).join("\n\n") || undefined,
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
      stream: generated.length ? injectFiles(result.stream, generated) : result.stream,
      originalMessages: incoming,
      // Wajib: tanpa ini balasan asisten tersimpan dengan id kosong dan bentrok di database.
      generateMessageId: () => crypto.randomUUID(),
      messageMetadata: ({ part }): MsgMeta | undefined => {
        if (part.type === "start") return { model: modelId, ...imageMeta };
        if (part.type === "finish")
          return { model: modelId, ...imageMeta, usage: { in: part.totalUsage.inputTokens, out: part.totalUsage.outputTokens } };
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
