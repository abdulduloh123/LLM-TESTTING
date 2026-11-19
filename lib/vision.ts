import { convertToModelMessages, generateText, type UIMessage } from "ai";
import type { makeModel } from "./providers";
import { isImagePart, textOf, type MsgMeta } from "./message-utils";

const MAX_DESCRIBE = 5; // paling banyak pesan bergambar yang dibaca per permintaan

const INSTRUCTIONS =
  'Kamu adalah "mata" bagi asisten teks yang tidak bisa melihat gambar. Jelaskan gambar yang diberikan selengkap dan seakurat mungkin, ' +
  "dalam bahasa yang dipakai pengguna: objek, orang (jangan menebak identitas), warna, tata letak, serta SEMUA teks yang terlihat " +
  "(tulis persis apa adanya), angka, tabel, kode, dan isi grafik. Fokus pada hal yang relevan dengan pesan pengguna, tetapi jangan " +
  'menjawab pertanyaannya. Bila ada beberapa gambar, beri label "Gambar 1", "Gambar 2", dan seterusnya. Balas hanya dengan deskripsinya.';

/**
 * Baca gambar di pesan pengguna yang belum punya deskripsi memakai model penglihatan.
 * Mengembalikan daftar baru; deskripsi disimpan di metadata pesan sehingga tidak dibaca ulang di giliran berikutnya.
 */
export async function describeImages(list: UIMessage[], model: ReturnType<typeof makeModel>, signal?: AbortSignal): Promise<UIMessage[]> {
  const todo = list
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === "user" && m.parts.some(isImagePart) && !(m.metadata as MsgMeta | undefined)?.imageDescription)
    .slice(-MAX_DESCRIBE);
  if (!todo.length) return list;

  const out = [...list];
  await Promise.all(
    todo.map(async ({ m, i }) => {
      const images = m.parts.filter(isImagePart);
      const question = textOf(m).trim().slice(0, 1500);
      const asker: UIMessage = {
        id: m.id,
        role: "user",
        parts: [{ type: "text", text: `Pesan pengguna: ${question || "(tidak ada teks, hanya gambar)"}` }, ...images],
      };
      const { text } = await generateText({
        model,
        instructions: INSTRUCTIONS,
        messages: await convertToModelMessages([asker]),
        maxOutputTokens: 2500,
        abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      });
      const description = text.trim().slice(0, 12_000);
      if (!description) throw new Error("Model penglihatan tidak mengembalikan deskripsi.");
      out[i] = { ...m, metadata: { ...(m.metadata as MsgMeta | undefined), imageDescription: description } };
    }),
  );
  return out;
}
