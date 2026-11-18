import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: ReturnType<typeof make> | null = null;
function make() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diatur");
  return drizzle(neon(url), { schema });
}
export function db() {
  return (_db ??= make());
}
export * from "./schema";
