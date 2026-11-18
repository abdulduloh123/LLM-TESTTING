import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFilename, toMarkdown } from "./export";

test("toMarkdown memuat judul, peran, dan model", () => {
  const md = toMarkdown("Judul", "2026-01-02T00:00:00Z", [
    { role: "user", text: "halo" },
    { role: "assistant", text: "hai", model: "gpt-x", images: 0 },
  ]);
  assert.match(md, /^# Judul/);
  assert.match(md, /## Anda\n\nhalo/);
  assert.match(md, /## Asisten \(gpt-x\)\n\nhai/);
  assert.match(md, /2026-01-02/);
});

test("safeFilename membersihkan karakter berbahaya", () => {
  assert.equal(safeFilename('a/b\\c:"d"', "md"), "abcd.md");
  assert.equal(safeFilename("", "json"), "percakapan.json");
  assert.equal(safeFilename("Halo Dunia", "md"), "Halo-Dunia.md");
});
