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
  let url: string;
  let headers: Record<string, string>;
  if (p.kind === "anthropic") {
    url = "https://api.anthropic.com/v1/models?limit=100";
    headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" };
  } else if (p.kind === "google") {
    url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200";
    headers = { "x-goog-api-key": p.apiKey };
  } else {
    const base = p.kind === "openai" ? "https://api.openai.com/v1" : p.baseUrl!.replace(/\/+$/, "");
    url = `${base}/models`;
    headers = { Authorization: `Bearer ${p.apiKey}` };
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new ProviderError(res.status);
  const json = await res.json();
  if (p.kind === "google") {
    return (json.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name: string; displayName?: string }) => ({
        id: m.name.replace(/^models\//, ""),
        label: m.displayName ?? m.name,
      }));
  }
  const list = (json.data ?? json.models ?? []) as { id: string; display_name?: string; name?: string }[];
  return list
    .map((m) => ({ id: m.id, label: m.display_name ?? m.name ?? m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Ubah galat provider menjadi pesan sederhana tanpa membocorkan detail/key. */
export function friendlyError(e: unknown): string {
  const status =
    e instanceof ProviderError
      ? e.status
      : (e as { statusCode?: number })?.statusCode ?? (e as { cause?: { statusCode?: number } })?.cause?.statusCode;
  if (status === 401 || status === 403) return "Key ditolak provider. Periksa key di layar Provider.";
  if (status === 402 || status === 429) return "Kuota atau batas permintaan habis. Coba lagi nanti atau pilih model lain.";
  if (status === 404) return "Model tidak ditemukan di provider. Pilih model lain.";
  if (e instanceof Error && e.name === "TimeoutError") return "Provider tidak merespons tepat waktu.";
  return "Provider mengembalikan galat. Coba lagi atau pilih model lain.";
}
