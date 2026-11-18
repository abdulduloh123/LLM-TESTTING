import { test } from "node:test";
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { forModel, packParts, sanitizeUserParts, unpack, META_TYPE, LIMITS } from "./message-utils";

test("sanitizeUserParts membuang URL luar dan tipe tak dikenal", () => {
  const out = sanitizeUserParts([
    { type: "text", text: "halo" },
    { type: "file", mediaType: "image/png", url: "https://evil.example/x.png" },
    { type: "file", mediaType: "image/png", url: "data:image/png;base64,AAAA" },
    { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,AAAA" },
    { type: "tool-x", foo: 1 },
  ]);
  assert.deepEqual(
    out.map((p) => p.type),
    ["text", "file"],
  );
});

test("sanitizeUserParts membatasi jumlah gambar", () => {
  const img = { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AA" };
  const out = sanitizeUserParts(Array.from({ length: LIMITS.maxImages + 3 }, () => img));
  assert.equal(out.length, LIMITS.maxImages);
});

test("sanitizeUserParts menolak masukan bukan array", () => {
  assert.deepEqual(sanitizeUserParts(undefined), []);
  assert.deepEqual(sanitizeUserParts("x"), []);
});

test("packParts/unpack menyimpan dan memulihkan usage", () => {
  const m = {
    id: "1",
    role: "assistant",
    parts: [{ type: "text", text: "hai" }],
    metadata: { model: "m", usage: { in: 5, out: 7 } },
  } as UIMessage;
  const packed = packParts(m);
  assert.equal((packed.at(-1) as { type: string }).type, META_TYPE);
  const u = unpack(packed, "m");
  assert.equal(u.parts.length, 1);
  assert.deepEqual(u.metadata, { model: "m", usage: { in: 5, out: 7 } });
});

test("unpack toleran terhadap data rusak", () => {
  assert.deepEqual(unpack(null, null), { parts: [], metadata: { model: null } });
});

test("forModel membuang reasoning dan balasan kosong", () => {
  const list = [
    { id: "1", role: "user", parts: [{ type: "text", text: "tanya" }] },
    { id: "2", role: "assistant", parts: [{ type: "reasoning", text: "mikir" }] },
    { id: "3", role: "assistant", parts: [{ type: "reasoning", text: "mikir" }, { type: "text", text: "jawab" }] },
  ] as UIMessage[];
  const out = forModel(list);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out[1].parts.map((p) => p.type),
    ["text"],
  );
});
