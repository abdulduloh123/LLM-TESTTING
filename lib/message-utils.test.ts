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

import { ensureIds } from "./message-utils";

test("ensureIds mengganti id kosong dan duplikat, mempertahankan yang valid", () => {
  const list = [{ id: "a" }, { id: "" }, { id: "a" }, { id: "b" }];
  const out = ensureIds(list, (i) => `gen-${i}`);
  assert.deepEqual(
    out.map((m) => m.id),
    ["a", "gen-1", "gen-2", "b"],
  );
  assert.equal(out[0], list[0]); // tidak diubah => objek sama
});

import { withImageDescriptions } from "./message-utils";

test("withImageDescriptions mengganti gambar dengan deskripsi", () => {
  const list = [
    {
      id: "1",
      role: "user",
      parts: [
        { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AA" },
        { type: "text", text: "apa ini?" },
      ],
      metadata: { imageDescription: "Seekor kucing." },
    },
  ] as UIMessage[];
  const out = withImageDescriptions(list, true);
  assert.deepEqual(out[0].parts.map((p) => p.type), ["text", "text"]);
  assert.match((out[0].parts[0] as { text: string }).text, /Seekor kucing/);
  assert.equal(withImageDescriptions(list, false), list);
});

test("packParts menyimpan imageDescription pada pesan pengguna", () => {
  const m = { id: "1", role: "user", parts: [{ type: "text", text: "x" }], metadata: { imageDescription: "d" } } as UIMessage;
  const u = unpack(packParts(m), null);
  assert.equal(u.metadata.imageDescription, "d");
});

test("forModel: gambar buatan asisten diganti catatan teks, bukan dikirim ke model", () => {
  const list = [
    { id: "1", role: "user", parts: [{ type: "text", text: "buat gaun" }] },
    {
      id: "2",
      role: "assistant",
      parts: [{ type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AA" }],
      metadata: { imagePrompt: "gaun merah" },
    },
  ] as UIMessage[];
  const out = forModel(list);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1].parts.map((p) => p.type), ["text"]);
  assert.match((out[1].parts[0] as { text: string }).text, /gaun merah/);
});

test("packParts menyimpan imagePrompt/imageModel pada balasan asisten", () => {
  const m = { id: "1", role: "assistant", parts: [{ type: "text", text: "x" }], metadata: { imagePrompt: "p", imageModel: "gemini-x" } } as UIMessage;
  const u = unpack(packParts(m), "m");
  assert.equal(u.metadata.imagePrompt, "p");
  assert.equal(u.metadata.imageModel, "gemini-x");
});
