export type ExportMsg = { role: string; text: string; model?: string | null; images?: number };

export function toMarkdown(title: string, createdAt: Date | string, msgs: ExportMsg[]): string {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  const lines = [`# ${title}`, "", `_Dibuat ${date}_`, ""];
  for (const m of msgs) {
    lines.push(m.role === "user" ? "## Anda" : `## Asisten${m.model ? ` (${m.model})` : ""}`, "");
    if (m.images) lines.push(`_[${m.images} gambar terlampir]_`, "");
    lines.push(m.text.trim(), "");
  }
  return lines.join("\n");
}

/** Nama file aman untuk header Content-Disposition. */
export function safeFilename(title: string, ext: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);
  return `${base || "percakapan"}.${ext}`;
}

export function attachment(filename: string, type: string, body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
