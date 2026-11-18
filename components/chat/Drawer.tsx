"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "./api";

export type Conv = { id: string; title: string; pinned: boolean; updatedAt: string; snippet?: string | null };

export default function Drawer(props: {
  convs: Conv[];
  activeId: string | null;
  query: string;
  setQuery: (q: string) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
  onDeleted: (id: string) => void;
}) {
  const { convs, activeId, query, setQuery, onClose, onOpen, onNew, onChanged, onDeleted } = props;
  const [menu, setMenu] = useState<string | null>(null);

  async function patch(id: string, body: object) {
    await api(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setMenu(null);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-[86%] max-w-sm flex-col bg-background pt-[env(safe-area-inset-top)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2 p-3">
          <input className="field" type="search" placeholder="Cari percakapan…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn" onClick={onNew} aria-label="Chat baru">
            ✎
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2">
          {convs.length === 0 && <p className="p-3 text-muted-fg">{query ? "Tidak ada hasil." : "Belum ada percakapan."}</p>}
          {convs.map((c) => (
            <div key={c.id} className={`rounded-xl ${c.id === activeId ? "bg-muted" : ""}`}>
              <div className="flex items-center">
                <button className="min-h-11 min-w-0 flex-1 px-3 py-2 text-left" onClick={() => onOpen(c.id)}>
                  <div className="truncate">
                    {c.pinned && "📌 "}
                    {c.title}
                  </div>
                  {c.snippet && <div className="truncate text-sm text-muted-fg">{c.snippet}</div>}
                </button>
                <button className="btn border-0 bg-transparent" aria-label="Aksi" onClick={() => setMenu(menu === c.id ? null : c.id)}>
                  ⋯
                </button>
              </div>
              {menu === c.id && (
                <div className="flex flex-wrap gap-2 px-3 pb-2">
                  <button className="btn flex-1" onClick={() => patch(c.id, { pinned: !c.pinned })}>
                    {c.pinned ? "Lepas pin" : "Pin"}
                  </button>
                  <button
                    className="btn flex-1"
                    onClick={() => {
                      const t = window.prompt("Nama baru", c.title);
                      if (t?.trim()) patch(c.id, { title: t.trim() });
                    }}
                  >
                    Ubah nama
                  </button>
                  <a className="btn flex-1" href={`/api/conversations/${c.id}/export?format=md`} download>
                    Ekspor
                  </a>
                  <button
                    className="btn flex-1 text-red-500"
                    onClick={async () => {
                      if (!window.confirm("Hapus percakapan ini?")) return;
                      await api(`/api/conversations/${c.id}`, { method: "DELETE" });
                      onDeleted(c.id);
                      setMenu(null);
                      onChanged();
                    }}
                  >
                    Hapus
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="flex gap-2 border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link href="/providers" className="btn flex-1">
            Provider
          </Link>
          <Link href="/settings" className="btn flex-1">
            Pengaturan
          </Link>
        </div>
      </aside>
    </div>
  );
}
