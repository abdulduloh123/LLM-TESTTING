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
 * Pesan terakhir selalu dipertahankan, dan hasil selalu dimulai dari pesan pengguna.
 */
export function trimToBudget<T extends Pick<UIMessage, "parts" | "role">>(
  list: T[],
  budget: number,
): { messages: T[]; dropped: number } {
  if (list.length === 0) return { messages: list, dropped: 0 };
  let total = 0;
  let start = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    const w = weigh(list[i]);
    if (i < list.length - 1 && total + w > budget) break;
    total += w;
    start = i;
  }
  while (start < list.length - 1 && list[start].role !== "user") start++;
  return { messages: list.slice(start), dropped: start };
}
