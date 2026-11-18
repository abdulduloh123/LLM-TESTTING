import { eq } from "drizzle-orm";
import { db, settings } from "./db";
import { normalizePrefs, parsePrefs, prefsSchema, type Prefs } from "./prefs-schema";

const KEY = "prefs";

export async function loadPrefs(): Promise<Prefs> {
  const [row] = await db().select().from(settings).where(eq(settings.key, KEY));
  return parsePrefs(row?.value);
}

/** Gabungkan perubahan ke pengaturan tersimpan. Disimpan di tabel `settings` yang sudah ada (tanpa migrasi). */
export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = normalizePrefs(prefsSchema.parse({ ...(await loadPrefs()), ...patch }));
  const value = JSON.stringify(next);
  await db().insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  return next;
}
