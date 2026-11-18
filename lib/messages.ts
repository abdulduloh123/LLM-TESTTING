import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db, messages } from "./db";
import { ensureIds, packParts, textOf, unpack, type MsgMeta } from "./message-utils";

export async function loadMessages(convId: string): Promise<UIMessage[]> {
  const rows = await db().select().from(messages).where(eq(messages.conversationId, convId)).orderBy(asc(messages.position));
  const list = rows.map((r) => {
    const u = unpack(r.parts, r.model);
    return { id: r.id, role: r.role as UIMessage["role"], parts: u.parts, metadata: u.metadata } as UIMessage;
  });
  // Data lama bisa berisi id kosong; beri id sementara yang stabil (baris diperbaiki saat disimpan berikutnya).
  return ensureIds(list, (i) => `${convId}-${i}`);
}

/**
 * Simpan daftar pesan percakapan secara aman:
 * hanya baris baru/berubah yang di-upsert, baris yang sudah tidak ada dihapus,
 * dan keduanya dijalankan dalam satu batch (transaksi) sehingga riwayat tidak bisa setengah hilang.
 */
export async function saveMessages(convId: string, list: UIMessage[], fallbackModel: string) {
  const clean = ensureIds(
    list.filter((m) => m.role !== "system" && (m.role === "user" || m.parts.length > 0)),
    () => crypto.randomUUID(),
  );
  const rows = clean.map((m, i) => ({
    id: m.id,
    conversationId: convId,
    position: i,
    role: m.role,
    parts: packParts(m),
    text: textOf(m),
    model: m.role === "assistant" ? ((m.metadata as MsgMeta | undefined)?.model ?? fallbackModel) : null,
  }));

  const existing = await db()
    .select({ id: messages.id, position: messages.position, role: messages.role, text: messages.text, model: messages.model })
    .from(messages)
    .where(eq(messages.conversationId, convId));
  const prev = new Map(existing.map((e) => [e.id, e]));
  const changed = rows.filter((r) => {
    const e = prev.get(r.id);
    return !e || e.position !== r.position || e.role !== r.role || e.text !== r.text || e.model !== r.model;
  });
  const keep = new Set(rows.map((r) => r.id));
  const hasStale = existing.some((e) => !keep.has(e.id));

  const ops = [];
  if (changed.length)
    ops.push(
      db()
        .insert(messages)
        .values(changed)
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            position: sql`excluded.position`,
            role: sql`excluded.role`,
            parts: sql`excluded.parts`,
            text: sql`excluded.text`,
            model: sql`excluded.model`,
          },
          // jangan pernah menimpa pesan milik percakapan lain bila id kebetulan bentrok
          setWhere: eq(messages.conversationId, convId),
        }),
    );
  if (hasStale)
    ops.push(
      db()
        .delete(messages)
        .where(
          keep.size
            ? and(eq(messages.conversationId, convId), notInArray(messages.id, [...keep]))
            : eq(messages.conversationId, convId),
        ),
    );
  if (ops.length) await db().batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
}
