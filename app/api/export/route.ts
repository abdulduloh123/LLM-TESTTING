import { asc, desc } from "drizzle-orm";
import { db, conversations, messages } from "@/lib/db";
import { guard } from "@/lib/session";
import { attachment } from "@/lib/export";

/** Ekspor seluruh percakapan (teks saja, tanpa gambar) sebagai satu berkas JSON. */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const [convs, msgs] = await Promise.all([
    db().select().from(conversations).orderBy(desc(conversations.updatedAt)),
    db()
      .select({ conversationId: messages.conversationId, position: messages.position, role: messages.role, text: messages.text, model: messages.model })
      .from(messages)
      .orderBy(asc(messages.conversationId), asc(messages.position)),
  ]);
  const by = new Map<string, { role: string; model: string | null; text: string }[]>();
  for (const m of msgs) {
    const list = by.get(m.conversationId) ?? [];
    list.push({ role: m.role, model: m.model, text: m.text });
    by.set(m.conversationId, list);
  }
  const data = {
    exportedAt: new Date().toISOString(),
    conversations: convs.map((c) => ({
      title: c.title,
      pinned: c.pinned,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      model: c.modelId,
      messages: by.get(c.id) ?? [],
    })),
  };
  return attachment(`llm-pribadi-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(data, null, 2));
}
