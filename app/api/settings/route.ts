import { guard } from "@/lib/session";
import { loadPrefs, savePrefs } from "@/lib/prefs";
import { prefsPatchSchema } from "@/lib/prefs-schema";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(await loadPrefs());
}

export async function PATCH(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = prefsPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pengaturan tidak valid" }, { status: 400 });
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  return Response.json(await savePrefs(patch));
}
