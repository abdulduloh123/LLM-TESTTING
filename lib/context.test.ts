import { test } from "node:test";
import assert from "node:assert/strict";
import { trimToBudget, estimateTokens } from "./context";

const msg = (role: "user" | "assistant", text: string) => ({ role, parts: [{ type: "text" as const, text }] });

test("tidak memangkas bila muat", () => {
  const list = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
  const r = trimToBudget(list, 10_000);
  assert.equal(r.dropped, 0);
  assert.equal(r.messages.length, 3);
});

test("memangkas pesan terlama dan mulai dari pesan user", () => {
  const big = "x".repeat(3000); // ~1000 token
  const list = [msg("user", big), msg("assistant", big), msg("user", big), msg("assistant", big), msg("user", "terakhir")];
  const r = trimToBudget(list, 2100);
  assert.equal(r.messages[r.messages.length - 1].parts[0].type, "text");
  assert.equal(r.messages[0].role, "user");
  assert.ok(r.dropped > 0);
});

test("pesan terakhir selalu dipertahankan walau melebihi budget", () => {
  const r = trimToBudget([msg("user", "x".repeat(30000))], 100);
  assert.equal(r.messages.length, 1);
});

test("daftar kosong", () => {
  assert.deepEqual(trimToBudget([], 10), { messages: [], dropped: 0 });
});

test("estimateTokens konservatif", () => {
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd"), 2);
});

test("pemangkasan memotong sampai ~70% budget agar awal riwayat stabil", () => {
  const m = (role: "user" | "assistant") => msg(role, "x".repeat(300)); // ~100 token
  const list = Array.from({ length: 20 }, (_, i) => m(i % 2 === 0 ? "user" : "assistant"));
  const budget = 1500; // total ~2000+ > budget
  const r = trimToBudget(list, budget);
  const kept = r.messages.length * 104;
  assert.ok(r.dropped > 0);
  assert.ok(kept <= budget * 0.7 + 104, `sisa ${kept} terlalu besar`);
});

test("tidak memangkas selama masih di bawah budget walau mendekati", () => {
  const list = Array.from({ length: 10 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(300)));
  assert.equal(trimToBudget(list, 1100).dropped, 0);
});
