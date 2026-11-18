import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type Kind = "openai" | "anthropic" | "google" | "openai-compatible";

export const PRESETS: Record<string, { label: string; kind: Kind; baseUrl?: string }> = {
  openai: { label: "OpenAI", kind: "openai" },
  anthropic: { label: "Anthropic", kind: "anthropic" },
  google: { label: "Google Gemini", kind: "google" },
  openrouter: { label: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1" },
  groq: { label: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1" },
  mistral: { label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1" },
  deepseek: { label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
  venice: { label: "Venice", kind: "openai-compatible", baseUrl: "https://api.venice.ai/api/v1" },
  custom: { label: "Kustom (OpenAI-compatible)", kind: "openai-compatible" },
};

export type ProviderCfg = { kind: Kind; name: string; baseUrl?: string | null; apiKey: string };

export function makeModel(p: ProviderCfg, modelId: string): LanguageModel {
  switch (p.kind) {
    case "openai":
      return createOpenAI({ apiKey: p.apiKey }).chat(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: p.apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: p.apiKey })(modelId);
    default:
      return createOpenAICompatible({
        name: p.name || "custom",
        apiKey: p.apiKey,
        baseURL: p.baseUrl!,
        includeUsage: true,
      }).chatModel(modelId);
  }
}

export type RemoteModel = { id: string; label: string };

export class ProviderError extends Error {
  constructor(public status: number) {
    super(`provider ${status}`);
  }
}

/** Ambil daftar model dari provider. Melempar bila gagal (dipakai juga sebagai tes koneksi). */
export async function fetchModels(p: ProviderCfg): Promise<RemoteModel[]> {
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!res.ok) throw new ProviderError(res.status);
    return res.json();
  };
  const dedupe = (list: RemoteModel[]) => [...new Map(list.map((m) => [m.id, m])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const MAX_PAGES = 5;

  if (p.kind === "anthropic") {
    const headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" };
    const out: RemoteModel[] = [];
    let after: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const json = await get(`https://api.anthropic.com/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, headers);
      for (const m of (json.data ?? []) as { id: string; display_name?: string }[]) out.push({ id: m.id, label: m.display_name ?? m.id });
      if (!json.has_more || !json.last_id) break;
      after = json.last_id;
    }
    return dedupe(out);
  }

  if (p.kind === "google") {
    const headers = { "x-goog-api-key": p.apiKey };
    const out: RemoteModel[] = [];
    let token: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const json = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, headers);
      for (const m of (json.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]) {
        if (m.supportedGenerationMethods?.includes("generateContent"))
          out.push({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name });
      }
      if (!json.nextPageToken) break;
      token = json.nextPageToken;
    }
    return dedupe(out);
  }

  const base = p.kind === "openai" ? "https://api.openai.com/v1" : p.baseUrl!.replace(/\/+$/, "");
  const json = await get(`${base}/models`, { Authorization: `Bearer ${p.apiKey}` });
  const list = (json.data ?? json.models ?? []) as { id: string; display_name?: string; name?: string }[];
  return dedupe(list.map((m) => ({ id: m.id, label: m.display_name ?? m.name ?? m.id })));
}

/** Ubah galat provider menjadi pesan sederhana tanpa membocorkan detail/key. */
export function friendlyError(e: unknown): string {
  const status =
    e instanceof ProviderError
      ? e.status
      : (e as { statusCode?: number })?.statusCode ?? (e as { cause?: { statusCode?: number } })?.cause?.statusCode;
  const detail = `${(e as { message?: string })?.message ?? ""} ${(e as { responseBody?: string })?.responseBody ?? ""}`.toLowerCase();

  if (status === 401 || status === 403) return "Key ditolak provider. Periksa key di layar Provider.";
  if (status === 402 || status === 429) return "Kuota atau batas permintaan habis. Coba lagi nanti atau pilih model lain.";
  if (status === 404) return "Model tidak ditemukan di provider. Pilih model lain.";
  if (status === 413 || /payload too large|request entity too large/.test(detail))
    return "Permintaan terlalu besar. Kurangi lampiran atau mulai percakapan baru.";
  if (/context.{0,20}(length|window)|too many tokens|maximum.{0,20}(length|tokens)|prompt is too long|input is too long/.test(detail))
    return "Percakapan terlalu panjang untuk model ini. Mulai chat baru atau turunkan batas konteks di Pengaturan.";
  if (/image|vision|multimodal|modalit/.test(detail) && (status === 400 || status === 422))
    return "Model ini tampaknya tidak mendukung gambar. Pilih model lain atau hapus gambarnya.";
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "Provider tidak merespons tepat waktu.";
  if (status && status >= 500) return "Provider sedang bermasalah. Coba lagi sebentar lagi.";
  return "Provider mengembalikan galat. Coba lagi atau pilih model lain.";
}
