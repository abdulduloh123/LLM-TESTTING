"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_BASE_SYSTEM, type Persona, type Prefs } from "@/lib/prefs-schema";

type ModelOpt = { id: string; providerId: string; providerName: string; modelId: string; label: string };

const THEME_KEY = "llm-pribadi:theme";

function applyTheme(t: Prefs["theme"]) {
  try {
    if (t === "system") {
      localStorage.removeItem(THEME_KEY);
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem(THEME_KEY, t);
      document.documentElement.dataset.theme = t;
    }
  } catch {}
}

async function j<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) window.location.href = "/login";
  return r.json();
}

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function SettingsPage() {
  const [p, setP] = useState<Prefs | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelOpt[]>([]);

  useEffect(() => {
    j<Prefs>("/api/settings").then(setP);
    j<ModelOpt[]>("/api/models").then((m) => Array.isArray(m) && setModels(m));
  }, []);

  if (!p)
    return (
      <main className="mx-auto max-w-xl px-4 py-6">
        <p className="text-muted-fg">Memuat…</p>
      </main>
    );

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });
  const setPersona = (id: string, patch: Partial<Persona>) =>
    set("personas", p.personas.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function save() {
    if (!p) return;
    setSaving(true);
    setNote("");
    const names = p.personas.filter((x) => !x.name.trim());
    if (names.length) {
      setSaving(false);
      return setNote("Setiap persona perlu nama.");
    }
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    setSaving(false);
    if (r.ok) {
      setP(await r.json());
      applyTheme(p.theme);
      setNote("Tersimpan.");
    } else {
      setNote((await r.json().catch(() => ({}))).error ?? "Gagal menyimpan.");
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-6 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Link href="/" className="btn" aria-label="Kembali">
          ←
        </Link>
        <h1 className="flex-1 text-xl font-semibold">Pengaturan</h1>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </header>
      {note && (
        <p role="status" className="text-muted-fg">
          {note}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Tampilan</h2>
        <label className="flex items-center justify-between gap-3">
          Tema
          <select className="field w-40" value={p.theme} onChange={(e) => set("theme", e.target.value as Prefs["theme"])}>
            <option value="system">Ikuti perangkat</option>
            <option value="light">Terang</option>
            <option value="dark">Gelap</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          Judul otomatis oleh model
          <input type="checkbox" className="h-6 w-6" checked={p.autoTitle} onChange={(e) => set("autoTitle", e.target.checked)} />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Persona (system prompt)</h2>
        <p className="text-sm text-muted-fg">Instruksi yang dikirim di awal setiap percakapan. Persona aktif juga bisa diganti dari menu pilih model.</p>
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <label className="flex items-center gap-2">
            <input type="radio" name="persona" checked={p.activePersonaId === null} onChange={() => set("activePersonaId", null)} />
            Prompt dasar (bawaan)
          </label>
          <textarea
            className="field min-h-36"
            maxLength={20000}
            placeholder="Kosongkan bila tidak ingin memakai system prompt."
            value={p.baseSystem}
            onChange={(e) => set("baseSystem", e.target.value)}
          />
          <p className="text-sm text-muted-fg">
            Dipakai saat tidak ada persona aktif. Dikirim di setiap pesan, jadi semakin pendek semakin hemat token (≈{Math.ceil(p.baseSystem.length / 3)} token).
          </p>
          <button className="btn self-start" onClick={() => set("baseSystem", DEFAULT_BASE_SYSTEM)}>
            Kembalikan ke bawaan
          </button>
        </div>
        {p.personas.map((x) => (
          <div key={x.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <input type="radio" name="persona" aria-label={`Aktifkan ${x.name}`} checked={p.activePersonaId === x.id} onChange={() => set("activePersonaId", x.id)} />
              <input className="field flex-1" placeholder="Nama persona" maxLength={40} value={x.name} onChange={(e) => setPersona(x.id, { name: e.target.value })} />
              <button
                className="btn text-red-500"
                aria-label={`Hapus ${x.name}`}
                onClick={() => setP({ ...p, personas: p.personas.filter((y) => y.id !== x.id), activePersonaId: p.activePersonaId === x.id ? null : p.activePersonaId })}
              >
                ✕
              </button>
            </div>
            <textarea
              className="field min-h-28"
              placeholder="Contoh: Kamu asisten yang ringkas dan menjawab dalam bahasa Indonesia."
              maxLength={20000}
              value={x.system}
              onChange={(e) => setPersona(x.id, { system: e.target.value })}
            />
          </div>
        ))}
        <button className="btn" onClick={() => set("personas", [...p.personas, { id: newId(), name: "Persona baru", system: "" }])} disabled={p.personas.length >= 30}>
          + Tambah persona
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Model</h2>
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between">
            Temperature <span className="text-muted-fg">{p.temperature === null ? "bawaan model" : p.temperature.toFixed(1)}</span>
          </span>
          <input type="range" min={0} max={2} step={0.1} value={p.temperature ?? 1} onChange={(e) => set("temperature", Number(e.target.value))} />
          <button className="self-start text-sm text-muted-fg underline" onClick={() => set("temperature", null)}>
            Pakai bawaan model
          </button>
        </label>
        <label className="flex flex-col gap-1">
          Batas panjang balasan (token)
          <input
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            max={200000}
            placeholder="Bawaan provider"
            value={p.maxTokens ?? ""}
            onChange={(e) => set("maxTokens", e.target.value === "" ? null : Math.max(1, Math.min(200000, Math.round(Number(e.target.value)))))}
          />
        </label>
        <label className="flex flex-col gap-1">
          Batas riwayat yang dikirim (perkiraan token)
          <input
            className="field"
            type="number"
            inputMode="numeric"
            min={1000}
            max={2000000}
            value={p.contextTokens}
            onChange={(e) => set("contextTokens", Math.max(1000, Math.min(2_000_000, Math.round(Number(e.target.value) || 1000))))}
          />
          <span className="text-sm text-muted-fg">Bila terlampaui, pesan terlama dipotong sampai ±70% batas (supaya awal riwayat stabil dan cache provider tetap terpakai). Makin kecil makin hemat token; naikkan bila butuh ingatan chat yang panjang.</span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Pembaca gambar</h2>
        <p className="text-sm text-muted-fg">
          Pilih model yang bisa melihat gambar. Setiap gambar yang kamu lampirkan akan dibaca model ini, lalu jawabannya tetap ditulis model yang kamu pilih di chat.
          Bila kosong, gambar dikirim langsung ke model terpilih.
        </p>
        <select
          className="field"
          value={p.visionModel ? `${p.visionModel.providerId}|${p.visionModel.modelId}` : ""}
          onChange={(e) => {
            const [providerId, ...rest] = e.target.value.split("|");
            set("visionModel", e.target.value ? { providerId, modelId: rest.join("|") } : null);
          }}
        >
          <option value="">Tidak ada (kirim langsung)</option>
          {models.map((m) => (
            <option key={m.id} value={`${m.providerId}|${m.modelId}`}>
              {m.providerName} — {m.label}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Pembuat gambar</h2>
        <p className="text-sm text-muted-fg">
          Pilih model gambar Gemini (misalnya yang namanya mengandung &quot;image&quot;). Nyalakan tombol 🎨 di chat untuk membuat atau mengedit gambar; model yang
          kamu pilih di chat tetap menulis balasan teksnya. Filter keamanan Google tetap berlaku, dan tiap gambar dikenai biaya.
        </p>
        <select
          className="field"
          value={p.imageModel ? `${p.imageModel.providerId}|${p.imageModel.modelId}` : ""}
          onChange={(e) => {
            const [providerId, ...rest] = e.target.value.split("|");
            set("imageModel", e.target.value ? { providerId, modelId: rest.join("|") } : null);
          }}
        >
          <option value="">Nonaktif</option>
          {(models.some((m) => /image/i.test(m.modelId)) ? models.filter((m) => /image/i.test(m.modelId)) : models).map((m) => (
            <option key={m.id} value={`${m.providerId}|${m.modelId}`}>
              {m.providerName} — {m.label}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Data</h2>
        <a className="btn" href="/api/export" download>
          Ekspor semua percakapan (JSON)
        </a>
        <button
          className="btn text-red-500"
          onClick={async () => {
            if (!window.confirm("Hapus SEMUA percakapan? Ini tidak bisa dibatalkan.")) return;
            await j("/api/conversations", { method: "DELETE" });
            setNote("Semua percakapan dihapus.");
          }}
        >
          Hapus semua percakapan
        </button>
        <Link href="/providers" className="btn">
          Kelola provider &amp; key
        </Link>
        <button
          className="btn"
          onClick={async () => {
            await j("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
            window.location.href = "/login";
          }}
        >
          Keluar
        </button>
      </section>
    </main>
  );
}
