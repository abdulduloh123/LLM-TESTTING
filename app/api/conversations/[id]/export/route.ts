import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, conversations } from "@/lib/db";
import { guard } from "@/lib/session";
import { loadMessages } from "@/lib/messages";
import { textOf, type MsgMeta } from "@/lib/message-utils";
import { attachment, safeFilename, toMarkdown } from "@/lib/export";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const [c] = await db().select().from(conversations).where(eq(conversations.id, id));
  if (!c) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const msgs = await loadMessages(id);
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";

  if (format === "json") {
    const data = {
      title: c.title,
      createdAt: c.createdAt,
      model: c.modelId,
      messages: msgs.map((m) => ({ role: m.role, model: (m.metadata as MsgMeta | undefined)?.model ?? null, text: textOf(m) })),
    };
    return attachment(safeFilename(c.title, "json"), "application/json", JSON.stringify(data, null, 2));
  }
  const md = toMarkdown(
    c.title,
    c.createdAt,
    msgs.map((m) => ({
      role: m.role,
      text: textOf(m),
      model: (m.metadata as MsgMeta | undefined)?.model,
      images: m.parts.filter((p) => p.type === "file").length,
    })),
  );
  return attachment(safeFilename(c.title, "md"), "text/markdown", md);
}
