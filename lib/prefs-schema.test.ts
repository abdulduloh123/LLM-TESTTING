import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, activeSystem, parsePrefs, prefsPatchSchema } from "./prefs-schema";

test("parsePrefs: kosong/rusak -> bawaan", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("bukan json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ temperature: 99 })), DEFAULT_PREFS);
});

test("parsePrefs: nilai sebagian digabung dengan bawaan", () => {
  const p = parsePrefs(JSON.stringify({ theme: "dark" }));
  assert.equal(p.theme, "dark");
  assert.equal(p.contextTokens, DEFAULT_PREFS.contextTokens);
});

test("persona aktif yang sudah tidak ada dinolkan", () => {
  const p = parsePrefs(JSON.stringify({ activePersonaId: "hilang", personas: [] }));
  assert.equal(p.activePersonaId, null);
});

test("activeSystem mengembalikan prompt persona aktif", () => {
  const p = parsePrefs(JSON.stringify({ personas: [{ id: "a", name: "A", system: " Jawab singkat. " }], activePersonaId: "a" }));
  assert.equal(activeSystem(p), "Jawab singkat.");
  assert.equal(activeSystem(DEFAULT_PREFS), DEFAULT_PREFS.baseSystem.trim());
  assert.equal(activeSystem({ ...DEFAULT_PREFS, baseSystem: "  " }), undefined);
});

test("patch schema menolak nilai di luar rentang", () => {
  assert.equal(prefsPatchSchema.safeParse({ temperature: 3 }).success, false);
  assert.equal(prefsPatchSchema.safeParse({ contextTokens: 10 }).success, false);
  assert.equal(prefsPatchSchema.safeParse({ temperature: 0.7 }).success, true);
});
