import type { UIMessage } from "ai";

/** Bagian khusus untuk menyimpan metadata (token) di kolom `parts` tanpa mengubah skema DB. */
export const META_TYPE = "data-meta";

export type Usage = { in?: number; out?: number };
export type MsgMeta = { model?: string | null; usage?: Usage };

export const LIMITS = {
  maxImages: 4,
  maxFileChars: 4_000_000, // total panjang data URL gambar per pesan (~3 MB biner)
  maxTextChars: 400_000,
};

export function textOf(m: Pick<UIMessage, "parts">): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

type AnyPart = { type: string; [k: string]: unknown };

/** Bersihkan pesan dari klien: hanya teks dan gambar `data:` (cegah URL luar / SSRF dan payload besar). */
export function sanitizeUserParts(parts: unknown): UIMessage["parts"] {
  if (!Array.isArray(parts)) return [];
  const out: AnyPart[] = [];
  let images = 0;
  let fileChars = 0;
  let textChars = 0;
  for (const p of parts as AnyPart[]) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "text" && typeof p.text === "string") {
      const room = LIMITS.maxTextChars - textChars;
      if (room <= 0) continue;
      const text = p.text.slice(0, room);
      textChars += text.length;
      out.push({ type: "text", text });
    } else if (
      p.type === "file" &&
      typeof p.url === "string" &&
      typeof p.mediaType === "string" &&
      p.mediaType.startsWith("image/") &&
      p.url.startsWith(`data:${p.mediaType}`) &&
      images < LIMITS.maxImages &&
      fileChars + p.url.length <= LIMITS.maxFileChars
    ) {
      images++;
      fileChars += p.url.length;
      out.push({
        type: "file",
        mediaType: p.mediaType,
        url: p.url,
        ...(typeof p.filename === "string" ? { filename: p.filename.slice(0, 120) } : {}),
      });
    }
  }
  return out as UIMessage["parts"];
}

/** Susun `parts` untuk disimpan: bagian pesan + satu bagian meta (bila ada token). */
export function packParts(m: UIMessage): unknown[] {
  const parts = m.parts.filter((p) => p.type !== META_TYPE);
  const meta = m.metadata as MsgMeta | undefined;
  if (m.role === "assistant" && meta?.usage && (meta.usage.in !== undefined || meta.usage.out !== undefined)) {
    return [...parts, { type: META_TYPE, data: { usage: meta.usage } }];
  }
  return parts;
}

/** Kebalikan packParts: pisahkan bagian meta menjadi `metadata`. */
export function unpack(parts: unknown, model: string | null): { parts: UIMessage["parts"]; metadata: MsgMeta } {
  const all = (Array.isArray(parts) ? parts : []) as AnyPart[];
  const meta = all.find((p) => p.type === META_TYPE) as { data?: { usage?: Usage } } | undefined;
  return {
    parts: all.filter((p) => p.type !== META_TYPE) as UIMessage["parts"],
    metadata: { model, ...(meta?.data?.usage ? { usage: meta.data.usage } : {}) },
  };
}

/**
 * Bentuk riwayat yang aman dikirim ke model:
 * hanya teks + gambar (reasoning/meta/sumber dibuang karena bisa ditolak provider lain),
 * dan balasan asisten yang kosong dibuang (provider menolak pesan kosong).
 */
export function forModel(list: UIMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const m of list) {
    if (m.role === "system") continue;
    const parts = m.parts.filter((p) => p.type === "text" || p.type === "file");
    const hasContent = parts.some((p) => (p.type === "text" ? p.text.trim() !== "" : true));
    if (!hasContent) continue;
    out.push({ ...m, parts });
  }
  return out;
}

/**
 * Pastikan setiap pesan punya id unik dan tidak kosong (id kosong/duplikat memicu bentrok primary key di DB).
 * `make` dipakai untuk membuat id pengganti.
 */
export function ensureIds<T extends { id: string }>(list: T[], make: (index: number) => string): T[] {
  const seen = new Set<string>();
  return list.map((m, i) => {
    let id = m.id;
    if (!id || seen.has(id)) id = make(i);
    seen.add(id);
    return id === m.id ? m : { ...m, id };
  });
}
