import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error("ENCRYPTION_KEY belum diatur");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY harus 32 byte (base64)");
  return k;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
