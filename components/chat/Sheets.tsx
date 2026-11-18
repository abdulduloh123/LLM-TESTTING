"use client";

import { useRef, useState } from "react";
import Link from "next/link";

export type Model = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  favorite: boolean;
  isDefault: boolean;
};
export type Sel = { providerId: string; modelId: string } | null;
export type PersonaOpt = { id: string; name: string };

export function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const [dy, setDy] = useState(0);
  const y0 = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[80dvh] w-full flex-col rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)]"
        style={{ transform: `translateY(${dy}px)`, transition: dragging ? undefined : "transform .2s" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex h-8 shrink-0 items-center justify-center"
          onTouchStart={(e) => {
            y0.current = e.touches[0].clientY;
            setDragging(true);
          }}
          onTouchMove={(e) => y0.current !== null && setDy(Math.max(0, e.touches[0].clientY - y0.current))}
          onTouchEnd={() => {
            const close = dy > 80;
            y0.current = null;
            setDragging(false);
            setDy(0);
            if (close) onClose();
          }}
        >
          <div className="h-1.5 w-10 rounded-full bg-border" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModelSheet(props: {
  models: Model[];
  sel: Sel;
  personas: PersonaOpt[];
  activePersonaId: string | null;
  onClose: () => void;
  onPick: (m: { providerId: string; modelId: string }) => void;
  onToggleFav: (m: Model) => void;
  onPersona: (id: string | null) => void;
}) {
  const { models, sel, personas, activePersonaId, onClose, onPick, onToggleFav, onPersona } = props;
  const [q, setQ] = useState("");
  const filtered = models.filter((m) => `${m.label} ${m.modelId} ${m.providerName}`.toLowerCase().includes(q.toLowerCase()));
  const favs = filtered.filter((m) => m.favorite);
  const groups = new Map<string, Model[]>();
  for (const m of filtered) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m]);

  const row = (m: Model, prefix = "") => (
    <div key={prefix + m.id} className="flex items-center">
      <button
        className={`btn min-w-0 flex-1 justify-start truncate border-0 bg-transparent text-left ${
          sel?.providerId === m.providerId && sel.modelId === m.modelId ? "font-semibold text-accent" : ""
        }`}
        onClick={() => onPick({ providerId: m.providerId, modelId: m.modelId })}
      >
        <span className="truncate">{m.label}</span>
      </button>
      <button className="btn border-0 bg-transparent" aria-label={m.favorite ? "Hapus favorit" : "Jadikan favorit"} onClick={() => onToggleFav(m)}>
        {m.favorite ? "★" : "☆"}
      </button>
    </div>
  );

  return (
    <Sheet onClose={onClose} title="Pilih model">
      <div className="flex flex-col gap-2 px-3 pb-2">
        {personas.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-fg">
            Persona
            <select className="field flex-1" value={activePersonaId ?? ""} onChange={(e) => onPersona(e.target.value || null)}>
              <option value="">Tanpa persona</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <input className="field" placeholder="Cari model…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {models.length === 0 && (
          <div className="p-4 text-center text-muted-fg">
            <p className="mb-3">Belum ada model.</p>
            <Link href="/providers" className="btn btn-primary">
              Tambah provider
            </Link>
          </div>
        )}
        {favs.length > 0 && (
          <section>
            <h3 className="px-3 py-1 text-sm text-muted-fg">Favorit</h3>
            {favs.map((m) => row(m, "fav-"))}
          </section>
        )}
        {[...groups].map(([name, list]) => (
          <section key={name}>
            <h3 className="px-3 py-1 text-sm text-muted-fg">{name}</h3>
            {list.slice(0, q ? 200 : 60).map((m) => row(m))}
            {!q && list.length > 60 && <p className="px-3 py-1 text-sm text-muted-fg">+{list.length - 60} model lain — gunakan pencarian.</p>}
          </section>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <Link href="/providers" className="btn w-full">
          Kelola provider &amp; model
        </Link>
      </div>
    </Sheet>
  );
}
