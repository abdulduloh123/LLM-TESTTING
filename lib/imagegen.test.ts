import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataUrl, parseGeminiResponse } from "./imagegen";

test("parseGeminiResponse mengambil gambar dan teks (camelCase)", () => {
  const r = parseGeminiResponse({
    candidates: [{ content: { parts: [{ text: "Ini dia" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] }, finishReason: "STOP" }],
  });
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].mediaType, "image/png");
  assert.equal(r.text, "Ini dia");
  assert.equal(r.blocked, null);
});

test("parseGeminiResponse mendukung snake_case", () => {
  const r = parseGeminiResponse({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "BB" } }] } }] });
  assert.deepEqual(r.images, [{ mediaType: "image/jpeg", base64: "BB" }]);
});

test("parseGeminiResponse mendeteksi pemblokiran", () => {
  assert.equal(parseGeminiResponse({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }).blocked, "PROHIBITED_CONTENT");
  assert.equal(parseGeminiResponse({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }).blocked, "IMAGE_SAFETY");
  assert.equal(parseGeminiResponse({}).images.length, 0);
});

test("parseDataUrl", () => {
  assert.deepEqual(parseDataUrl("data:image/jpeg;base64,AAAA"), { mediaType: "image/jpeg", base64: "AAAA" });
  assert.equal(parseDataUrl("https://x/y.png"), null);
  assert.equal(parseDataUrl("data:text/plain;base64,AA"), null);
});
