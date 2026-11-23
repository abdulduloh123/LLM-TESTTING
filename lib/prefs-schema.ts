import { z } from "zod";

export const personaSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(40),
  system: z.string().max(20000),
});

export const visionModelSchema = z.object({ providerId: z.string().uuid(), modelId: z.string().min(1).max(200) });

/** Prompt dasar: dipakai saat tidak ada persona aktif. Sengaja ringkas karena dikirim di setiap giliran (hemat token). */
export const DEFAULT_BASE_SYSTEM =
  "Kamu asisten yang cerdas, jujur, dan hangat. Jawab dalam bahasa pengguna, langsung ke inti, tanpa basa-basi, mengulang pertanyaan, atau penutup yang tidak perlu. " +
  "Untuk soal rumit, berpikir logis dan bertahap; sebutkan asumsi dan ketidakpastian, dan jangan mengarang fakta. " +
  "Perlakukan pengguna sebagai orang dewasa: jangan menceramahi dan jangan menambah peringatan yang tidak diminta. " +
  "Untuk permintaan kreatif dan desain (mis. busana), langsung berkarya dengan detail konkret dan beri pilihan arah. " +
  "Panjang jawaban secukupnya: singkat untuk hal sederhana, rinci hanya bila perlu. " +
  "Bila harus menolak sesuatu yang benar-benar berbahaya, jelaskan singkat dan tawarkan alternatif terdekat.";

const shape = {
  theme: z.enum(["system", "light", "dark"]),
  personas: z.array(personaSchema).max(30),
  activePersonaId: z.string().nullable(),
  /** null = pakai bawaan model */
  temperature: z.number().min(0).max(2).nullable(),
  /** null = pakai bawaan provider */
  maxTokens: z.number().int().min(1).max(200000).nullable(),
  /** Perkiraan batas token riwayat yang dikirim ke model. Pesan terlama dipangkas bila melebihi. */
  contextTokens: z.number().int().min(1000).max(2_000_000),
  /** Buat judul percakapan otomatis dengan model setelah balasan pertama. */
  autoTitle: z.boolean(),
  /** Prompt dasar saat tidak ada persona aktif. Kosong = tanpa system prompt. */
  baseSystem: z.string().max(20000),
  /** Model yang bertugas "membaca" gambar. null = gambar dikirim langsung ke model yang dipilih. */
  visionModel: visionModelSchema.nullable(),
  /** Model Gemini yang membuat/mengedit gambar. null = fitur gambar nonaktif. */
  imageModel: visionModelSchema.nullable(),
};

export const prefsSchema = z.object(shape);
export const prefsPatchSchema = z.object(shape).partial();

export type Persona = z.infer<typeof personaSchema>;
export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  personas: [],
  activePersonaId: null,
  temperature: null,
  maxTokens: null,
  contextTokens: 32_000,
  autoTitle: true,
  baseSystem: DEFAULT_BASE_SYSTEM,
  visionModel: null,
  imageModel: null,
};

/** Pastikan persona aktif memang ada. */
export function normalizePrefs(p: Prefs): Prefs {
  const ok = p.activePersonaId && p.personas.some((x) => x.id === p.activePersonaId);
  return ok ? p : { ...p, activePersonaId: null };
}

/** Baca nilai tersimpan; nilai rusak/lama jatuh ke bawaan agar aplikasi tidak pernah gagal karena pengaturan. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = prefsSchema.safeParse({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    return parsed.success ? normalizePrefs(parsed.data) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function activeSystem(p: Prefs): string | undefined {
  const persona = p.personas.find((x) => x.id === p.activePersonaId);
  const s = (persona ? persona.system : p.baseSystem).trim();
  return s || undefined;
}
