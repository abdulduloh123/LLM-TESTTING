import type { UIMessage } from "ai";

/** Bagian khusus untuk menyimpan metadata (token) di kolom `parts` tanpa mengubah skema DB. */
export const META_TYPE = "data-meta";

export type Usage = { in?: number; out?: number };
export type MsgMeta = {
  model?: string | null;
  usage?: Usage;
  /** Deskripsi gambar hasil model penglihatan (pada pesan pengguna yang berisi gambar). */
  imageDescription?: string;
  /** Pada balasan asisten yang berisi gambar buatan: prompt dan model yang membuatnya. */
  imagePrompt?: string;
  imageModel?: string;
};

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

type StoredMeta = { usage?: Usage; imageDescription?: string; imagePrompt?: string; imageModel?: string };

/** Susun `parts` untuk disimpan: bagian pesan + satu bagian meta (token, deskripsi/prompt gambar) bila ada. */
export function packParts(m: UIMessage): unknown[] {
  const parts = m.parts.filter((p) => p.type !== META_TYPE);
  const meta = m.metadata as MsgMeta | undefined;
  const data: StoredMeta = {};
  if (m.role === "assistant") {
    if (meta?.usage && (meta.usage.in !== undefined || meta.usage.out !== undefined)) data.usage = meta.usage;
    if (meta?.imagePrompt) data.imagePrompt = meta.imagePrompt;
    if (meta?.imageModel) data.imageModel = meta.imageModel;
  }
  if (m.role === "user" && meta?.imageDescription) data.imageDescription = meta.imageDescription;
  return Object.keys(data).length ? [...parts, { type: META_TYPE, data }] : parts;
}

/** Kebalikan packParts: pisahkan bagian meta menjadi `metadata`. */
export function unpack(parts: unknown, model: string | null): { parts: UIMessage["parts"]; metadata: MsgMeta } {
  const all = (Array.isArray(parts) ? parts : []) as AnyPart[];
  const meta = all.find((p) => p.type === META_TYPE) as { data?: StoredMeta } | undefined;
  const d = meta?.data;
  return {
    parts: all.filter((p) => p.type !== META_TYPE) as UIMessage["parts"],
    metadata: {
      model,
      ...(d?.usage ? { usage: d.usage } : {}),
      ...(d?.imageDescription ? { imageDescription: d.imageDescription } : {}),
      ...(d?.imagePrompt ? { imagePrompt: d.imagePrompt } : {}),
      ...(d?.imageModel ? { imageModel: d.imageModel } : {}),
    },
  };
}

export const isImagePart = (p: { type: string }) => p.type === "file";

/**
 * Bila model penglihatan aktif, gambar di pesan pengguna diganti dengan deskripsinya (teks)
 * agar model jawaban (yang mungkin tidak bisa melihat gambar) tidak menerima data gambar.
 */
export function withImageDescriptions(list: UIMessage[], active: boolean): UIMessage[] {
  if (!active) return list;
  return list.map((m) => {
    if (m.role !== "user" || !m.parts.some(isImagePart)) return m;
    const desc = (m.metadata as MsgMeta | undefined)?.imageDescription;
    const note = desc ? `[Lampiran gambar — dibaca oleh model penglihatan]\n${desc}` : "[Lampiran gambar tidak disertakan]";
    return { ...m, parts: [{ type: "text", text: note } as UIMessage["parts"][number], ...m.parts.filter((p) => !isImagePart(p))] };
  });
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
    let parts: UIMessage["parts"] = m.parts.filter((p) => p.type === "text" || p.type === "file");
    if (m.role === "assistant") {
      // Gambar buatan tidak dikirim balik ke model teks; cukup catatan singkat tentang gambarnya.
      const meta = m.metadata as MsgMeta | undefined;
      const hadImages = parts.some((p) => p.type === "file");
      parts = parts.filter((p) => p.type === "text");
      if (hadImages)
        parts = [
          { type: "text", text: `[Gambar dibuat oleh model gambar${meta?.imagePrompt ? ` dari prompt: ${meta.imagePrompt}` : ""}]` } as UIMessage["parts"][number],
          ...parts,
        ];
    }
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
