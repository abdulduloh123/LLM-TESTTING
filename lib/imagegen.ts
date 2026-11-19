import sharp from "sharp";

export type Img = { mediaType: string; base64: string };

export class ImageGenError extends Error {}

type Part = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};
type GeminiResponse = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

const BLOCKED = new Set(["IMAGE_SAFETY", "PROHIBITED_CONTENT", "SAFETY", "IMAGE_PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_RECITATION", "IMAGE_OTHER"]);

/** Ambil gambar/teks dari respons generateContent Gemini. */
export function parseGeminiResponse(json: GeminiResponse): { images: Img[]; text: string; blocked: string | null } {
  const images: Img[] = [];
  let text = "";
  const cand = json.candidates?.[0];
  for (const p of cand?.content?.parts ?? []) {
    const inline = p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined);
    if (inline?.data) images.push({ mediaType: inline.mimeType ?? "image/png", base64: inline.data });
    else if (p.text) text += p.text;
  }
  const reason = json.promptFeedback?.blockReason ?? (cand?.finishReason && BLOCKED.has(cand.finishReason) ? cand.finishReason : null);
  return { images, text: text.trim(), blocked: reason ?? null };
}

function httpMessage(status: number, body: string): string {
  let detail = "";
  try {
    detail = (JSON.parse(body) as GeminiResponse).error?.message ?? "";
  } catch {}
  const tail = detail ? ` (${detail.slice(0, 200)})` : "";
  if (status === 401 || status === 403) return `Key Gemini ditolak atau tidak punya akses ke model gambar.${tail}`;
  if (status === 404) return `Model gambar tidak ditemukan. Pilih model gambar lain di Pengaturan.${tail}`;
  if (status === 429) return `Kuota model gambar habis. Model gambar Gemini umumnya butuh akun berbayar (billing aktif).${tail}`;
  if (status >= 500) return `Layanan Gemini sedang bermasalah. Coba lagi sebentar lagi.${tail}`;
  return `Permintaan ditolak model gambar.${tail}`;
}

async function callOnce(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  refs: Img[];
  aspectRatio?: string;
  signal?: AbortSignal;
}): Promise<Img> {
  const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
  if (opts.aspectRatio) generationConfig.imageConfig = { aspectRatio: opts.aspectRatio };
  const body = {
    contents: [
      {
        role: "user",
        parts: [...opts.refs.map((r) => ({ inline_data: { mime_type: r.mediaType, data: r.base64 } })), { text: opts.prompt }],
      },
    ],
    generationConfig,
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);

  const post = (b: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify(b),
      signal,
      cache: "no-store",
    });

  let res = await post(body);
  // Sebagian model menolak imageConfig; coba ulang tanpa rasio.
  if (res.status === 400 && opts.aspectRatio) {
    const retry = { ...body, generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
    res = await post(retry);
  }
  const raw = await res.text();
  if (!res.ok) throw new ImageGenError(httpMessage(res.status, raw));

  const parsed = parseGeminiResponse(JSON.parse(raw) as GeminiResponse);
  if (parsed.images.length) return parsed.images[0];
  if (parsed.blocked)
    throw new ImageGenError(
      `Permintaan diblokir filter keamanan Google (${parsed.blocked}). Coba ubah deskripsinya, misalnya fokus pada pakaian dan desain, atau hindari wajah orang nyata.`,
    );
  if (parsed.text) throw new ImageGenError(`Model gambar membalas teks tanpa membuat gambar: ${parsed.text.slice(0, 300)}`);
  throw new ImageGenError("Model gambar tidak menghasilkan gambar. Coba ubah deskripsinya.");
}

/** Perkecil ke JPEG agar riwayat di database tidak membengkak. */
export async function compress(img: Img): Promise<Img> {
  const out = await sharp(Buffer.from(img.base64, "base64"))
    .rotate()
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  return { mediaType: "image/jpeg", base64: out.toString("base64") };
}

/** Buat `count` gambar (satu panggilan per gambar, paralel). Berhasil sebagian tetap dikembalikan. */
export async function generateImages(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  refs: Img[];
  aspectRatio?: string;
  count: number;
  signal?: AbortSignal;
}): Promise<Img[]> {
  const results = await Promise.allSettled(
    Array.from({ length: opts.count }, async () => compress(await callOnce(opts))),
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (ok.length) return ok;
  const err = (results[0] as PromiseRejectedResult).reason;
  throw err instanceof ImageGenError ? err : new ImageGenError("Gagal menghubungi model gambar. Coba lagi.");
}

/** Pecah data URL base64 menjadi bagian-bagiannya; null bila bukan gambar. */
export function parseDataUrl(url: string): Img | null {
  const m = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
  return m ? { mediaType: m[1], base64: m[2] } : null;
}
