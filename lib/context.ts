import type { UIMessage } from "ai";

const IMAGE_TOKENS = 1200;

/** Perkiraan kasar (sengaja konservatif): ~3 karakter per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function weigh(m: Pick<UIMessage, "parts">): number {
  let n = 4;
  for (const p of m.parts) {
    if (p.type === "text") n += estimateTokens(p.text);
    else if (p.type === "file") n += IMAGE_TOKENS;
  }
  return n;
}

/**
 * Pangkas pesan terlama agar total perkiraan token ≤ budget.
 * Pemangkasan baru terjadi saat budget terlampaui dan langsung memotong sampai ~70% budget, sehingga awal
 * riwayat tetap sama selama beberapa giliran (cache prompt provider tetap kena, biaya turun).
 * Pesan terakhir selalu dipertahankan, dan hasil selalu dimulai dari pesan pengguna.
 */
export function trimToBudget<T extends Pick<UIMessage, "parts" | "role">>(
  list: T[],
  budget: number,
): { messages: T[]; dropped: number } {
  if (list.length === 0) return { messages: list, dropped: 0 };
  const weights = list.map(weigh);
  if (weights.reduce((a, b) => a + b, 0) <= budget) return { messages: list, dropped: 0 };

  const target = budget * 0.7;
  let total = 0;
  let start = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (i < list.length - 1 && total + weights[i] > target) break;
    total += weights[i];
    start = i;
  }
  while (start < list.length - 1 && list[start].role !== "user") start++;
  return { messages: list.slice(start), dropped: start };
}
