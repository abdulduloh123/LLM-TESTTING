"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => (d.authed ? router.replace("/") : setSetup(d.setup)))
      .catch(() => setError("Tidak bisa menghubungi server. Periksa DATABASE_URL."));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: setup ? "login" : "setup", password }),
    });
    setBusy(false);
    if (r.ok) router.replace("/");
    else setError((await r.json().catch(() => ({}))).error ?? "Gagal masuk");
  }

  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-5 px-4">
      <h1 className="text-2xl font-semibold">LLM Pribadi</h1>
      {setup === null && !error ? (
        <p className="text-muted-fg">Memuat…</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-muted-fg">
            {setup ? "Masukkan password untuk masuk." : "Pertama kali: buat password (minimal 8 karakter)."}
          </p>
          <input
            className="field"
            type="password"
            autoComplete={setup ? "current-password" : "new-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p role="alert" className="text-red-500">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !password}>
            {busy ? "Memproses…" : setup ? "Masuk" : "Buat password"}
          </button>
        </form>
      )}
      {setup === null && error && <p role="alert" className="text-red-500">{error}</p>}
    </main>
  );
}
