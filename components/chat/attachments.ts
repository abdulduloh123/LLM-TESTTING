export type Attachment =
  | { id: string; kind: "image"; name: string; mediaType: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

export const MAX_IMAGES = 4;
export const MAX_TOTAL_IMAGE_CHARS = 3_000_000; // di bawah batas body 4,5 MB platform
const MAX_TEXT_CHARS = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sh|sql|yml|yaml|toml|ini|log|env)$/i;

let n = 0;
const uid = () => `${Date.now().toString(36)}-${n++}`;

async function shrinkImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Baca berkas pilihan pengguna. Melempar Error berpesan ramah bila tidak didukung. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) {
    const url = await shrinkImage(file).catch(() => {
      throw new Error(`Gambar "${file.name}" tidak bisa dibaca.`);
    });
    return { id: uid(), kind: "image", name: file.name, mediaType: "image/jpeg", url };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT_CHARS * 4) throw new Error(`"${file.name}" terlalu besar (maks ~200 ribu karakter).`);
    const text = (await file.text()).slice(0, MAX_TEXT_CHARS);
    return { id: uid(), kind: "text", name: file.name, text };
  }
  throw new Error(`Jenis berkas "${file.name}" belum didukung. Gunakan gambar atau berkas teks/kode.`);
}

export const ATTACH_MARK = /^\[Lampiran: (.+?)\]\n/;

/** Bungkus isi berkas teks agar tampil terlipat di gelembung pesan. */
export function textAttachmentPart(a: Extract<Attachment, { kind: "text" }>): string {
  return `[Lampiran: ${a.name}]\n\`\`\`\`\n${a.text}\n\`\`\`\``;
}
