export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return r.json();
}

/** Pesan galat dari useChat bisa berupa JSON mentah ({"error":"..."}); ambil teks yang ramah. */
export function errorText(message: string | undefined): string {
  if (!message) return "Terjadi galat.";
  try {
    const j = JSON.parse(message);
    if (typeof j?.error === "string") return j.error;
  } catch {}
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "Koneksi terputus. Periksa jaringan lalu coba lagi.";
  return message;
}
