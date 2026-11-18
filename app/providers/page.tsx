"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Provider = { id: string; preset: string; kind: string; name: string; baseUrl: string | null; keyLast4: string; status: string };
type Model = { id: string; providerId: string; modelId: string; label: string; favorite: boolean; isDefault: boolean };

const PRESETS: [string, string][] = [
  ["openrouter", "OpenRouter"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google Gemini"],
  ["groq", "Groq"],
  ["mistral", "Mistral"],
  ["deepseek", "DeepSeek"],
  ["venice", "Venice"],
  ["custom", "Kustom (OpenAI-compatible)"],
];

async function j<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) {
    window.location.assign("/login");
  }
  return r.json();
}

export default function ProvidersPage() {
  const [list, setList] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([j<Provider[]>("/api/providers"), j<Model[]>("/api/models")]);
    if (Array.isArray(p)) setList(p);
    if (Array.isArray(m)) setModels(m);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function test(id: string) {
    setNote((n) => ({ ...n, [id]: "Menguji…" }));
    const r = await j<{ ok: boolean; added?: number; error?: string }>(`/api/providers/${id}`, { method: "POST" });
    setNote((n) => ({ ...n, [id]: r.ok ? `Tersambung. ${r.added} model baru.` : (r.error ?? "Gagal") }));
    load();
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-4 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Link href="/" className="btn" aria-label="Kembali">
          ←
        </Link>
        <h1 className="flex-1 text-xl font-semibold">Provider &amp; key</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + Tambah
        </button>
      </header>

      {adding && (
        <AddForm
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {list.length === 0 && !adding && <p className="text-muted-fg">Belum ada provider. Ketuk “Tambah”.</p>}

      {list.map((p) => {
        const ms = models.filter((m) => m.providerId === p.id);
        return (
          <section key={p.id} className="rounded-2xl border border-border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="text-sm text-muted-fg">
                  key …{p.keyLast4} · {p.status === "ok" ? "tersambung" : p.status === "error" ? "galat" : "belum diuji"} · {ms.length} model
                </div>
              </div>
            </div>
            {note[p.id] && <p className="mt-2 text-sm">{note[p.id]}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" onClick={() => test(p.id)}>
                Tes koneksi
              </button>
              <button className="btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
                Model
              </button>
              <button
                className="btn text-red-500"
                onClick={async () => {
                  if (!window.confirm(`Hapus ${p.name} beserta key-nya?`)) return;
                  await j(`/api/providers/${p.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Hapus
              </button>
            </div>
            {open === p.id && <ModelList provider={p} models={ms} reload={load} />}
          </section>
        );
      })}

      <section className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <button
          className="btn"
          onClick={async () => {
            await j("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
            window.location.assign("/login");
          }}
        >
          Keluar
        </button>
      </section>
    </main>
  );
}

function ModelList({ provider, models, reload }: { provider: Provider; models: Model[]; reload: () => void }) {
  const [manual, setManual] = useState("");
  const [q, setQ] = useState("");
  const shown = models.filter((m) => m.modelId.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <input className="field" placeholder="Nama model manual" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button
          className="btn"
          disabled={!manual.trim()}
          onClick={async () => {
            await j("/api/models", { method: "POST", body: JSON.stringify({ providerId: provider.id, modelId: manual.trim() }) });
            setManual("");
            reload();
          }}
        >
          Tambah
        </button>
      </div>
      <input className="field" placeholder="Cari model…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-80 overflow-y-auto">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{m.modelId}</span>
            <button
              className="btn border-0 bg-transparent"
              aria-label="Favorit"
              onClick={async () => {
                await j("/api/models", { method: "PATCH", body: JSON.stringify({ id: m.id, favorite: !m.favorite }) });
                reload();
              }}
            >
              {m.favorite ? "★" : "☆"}
            </button>
            <button
              className={`btn ${m.isDefault ? "btn-primary" : ""}`}
              onClick={async () => {
                await j("/api/models", { method: "PATCH", body: JSON.stringify({ id: m.id, isDefault: !m.isDefault }) });
                reload();
              }}
            >
              {m.isDefault ? "Bawaan" : "Jadikan bawaan"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState("openrouter");
  const [name, setName] = useState("OpenRouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await j<{ error?: string }>("/api/providers", {
      method: "POST",
      body: JSON.stringify({ preset, name, apiKey, ...(preset === "custom" ? { baseUrl } : {}) }),
    });
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-border p-3">
      <label className="flex flex-col gap-1">
        Provider
        <select
          className="field"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            setName(PRESETS.find(([k]) => k === e.target.value)![1].replace(/ \(.*/, ""));
          }}
        >
          {PRESETS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {preset === "custom" && (
        <label className="flex flex-col gap-1">
          Base URL (mis. https://api.contoh.ai/v1)
          <input className="field" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
        </label>
      )}
      <label className="flex flex-col gap-1">
        Nama
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1">
        API key
        <div className="flex gap-2">
          <input
            className="field"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                setApiKey((await navigator.clipboard.readText()).trim());
              } catch {}
            }}
          >
            Tempel
          </button>
        </div>
      </label>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn flex-1" onClick={onDone}>
          Batal
        </button>
        <button className="btn btn-primary flex-1" disabled={busy}>
          {busy ? "Menguji…" : "Simpan & tes"}
        </button>
      </div>
    </form>
  );
}
