"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Markdown from "./Markdown";

type Model = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  favorite: boolean;
  isDefault: boolean;
};
type Conv = { id: string; title: string; pinned: boolean; updatedAt: string; snippet?: string | null };
type Sel = { providerId: string; modelId: string } | null;
type Meta = { model?: string | null };

const LAST_KEY = "llm-pribadi:last-model";

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 401) {
    window.location.assign("/login");
    throw new Error("unauthorized");
  }
  return r.json();
}

export default function Chat() {
  const [models, setModels] = useState<Model[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [showDown, setShowDown] = useState(false);
  const [ready, setReady] = useState(false);

  const convRef = useRef<string | null>(null);
  const selRef = useRef<Sel>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    convRef.current = convId;
    selRef.current = sel;
  }, [convId, sel]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            id: convRef.current,
            messages,
            providerId: selRef.current?.providerId,
            modelId: selRef.current?.modelId,
          },
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, regenerate, stop, status, error, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  const refreshConvs = useCallback(async (q = "") => {
    const list = await api<Conv[]>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (Array.isArray(list)) setConvs(list);
  }, []);

  const chooseModel = useCallback((m: { providerId: string; modelId: string }) => {
    setSel({ providerId: m.providerId, modelId: m.modelId });
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(m));
    } catch {}
  }, []);

  const openConv = useCallback(
    async (id: string) => {
      const c = await api<{ id: string; providerId: string | null; modelId: string | null; messages: UIMessage[] }>(`/api/conversations/${id}`);
      if (!c?.id) return;
      setConvId(c.id);
      convRef.current = c.id;
      setMessages(c.messages);
      if (c.providerId && c.modelId) chooseModel({ providerId: c.providerId, modelId: c.modelId });
      window.history.replaceState(null, "", `/?c=${c.id}`);
      stick.current = true;
      setDrawer(false);
    },
    [setMessages, chooseModel],
  );

  const newChat = useCallback(() => {
    stop();
    setConvId(null);
    convRef.current = null;
    setMessages([]);
    clearError();
    window.history.replaceState(null, "", "/");
    setDrawer(false);
  }, [stop, setMessages, clearError]);

  // Muat awal
  useEffect(() => {
    (async () => {
      const list = await api<Model[]>("/api/models");
      if (Array.isArray(list)) {
        setModels(list);
        let last: Sel = null;
        try {
          last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
        } catch {}
        const valid = last && list.find((m) => m.providerId === last!.providerId && m.modelId === last!.modelId);
        const def = list.find((m) => m.isDefault) ?? list.find((m) => m.favorite);
        const pick = valid ? last : def ? { providerId: def.providerId, modelId: def.modelId } : null;
        if (pick) setSel(pick);
      }
      refreshConvs();
      const c = new URLSearchParams(window.location.search).get("c");
      if (c) await openConv(c);
      setReady(true);
    })().catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === "ready") refreshConvs(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const t = setTimeout(() => refreshConvs(query), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Auto-scroll hanya bila pengguna tidak menggulir ke atas
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function onScroll() {
    const el = scroller.current!;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setShowDown(!near);
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (!sel) {
      setSheet(true);
      return;
    }
    clearError();
    if (!convRef.current) {
      const c = await api<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ providerId: sel.providerId, modelId: sel.modelId }),
      });
      setConvId(c.id);
      convRef.current = c.id;
      window.history.replaceState(null, "", `/?c=${c.id}`);
    }
    stick.current = true;
    await sendMessage({ text: t });
  }

  async function submitEdit() {
    if (!editing) return;
    const idx = messages.findIndex((m) => m.id === editing.id);
    const text = editing.text;
    setEditing(null);
    if (idx < 0) return;
    setMessages(messages.slice(0, idx));
    await send(text);
  }

  const current = models.find((m) => m.providerId === sel?.providerId && m.modelId === sel?.modelId);
  const modelName = current?.label ?? sel?.modelId ?? "Pilih model";

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <button className="btn border-0 bg-transparent" aria-label="Riwayat" onClick={() => setDrawer(true)}>
          ☰
        </button>
        <button
          className="btn min-w-0 flex-1 justify-center truncate"
          onClick={() => setSheet(true)}
          aria-label="Ganti model"
        >
          <span className="truncate">{modelName}</span>
          <span aria-hidden>▾</span>
        </button>
        <button className="btn border-0 bg-transparent" aria-label="Chat baru" onClick={newChat}>
          ✎
        </button>
      </header>

      {/* Pesan */}
      <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {ready && messages.length === 0 && (
            <div className="mt-16 text-center text-muted-fg">
              {models.length === 0 ? (
                <>
                  <p className="mb-3">Belum ada provider.</p>
                  <Link href="/providers" className="btn btn-primary">
                    Tambah provider &amp; key
                  </Link>
                </>
              ) : (
                <p>Mulai percakapan dengan {modelName}.</p>
              )}
            </div>
          )}

          {messages.map((m) => (
            <MessageView
              key={m.id}
              m={m}
              isLast={m.id === lastAssistant?.id}
              busy={busy}
              editing={editing?.id === m.id ? editing : null}
              setEditing={setEditing}
              submitEdit={submitEdit}
              onRegenerate={() => regenerate()}
            />
          ))}

          {status === "submitted" && <p className="text-muted-fg">Berpikir…</p>}

          {error && (
            <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3">
              <p>{error.message || "Terjadi galat."}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href="/providers" className="btn">
                  Periksa key
                </Link>
                <button className="btn" onClick={() => setSheet(true)}>
                  Pilih model lain
                </button>
                <button className="btn" onClick={() => regenerate()}>
                  Coba lagi
                </button>
              </div>
            </div>
          )}
        </div>

        {showDown && (
          <button
            className="btn btn-primary sticky bottom-2 left-full ml-auto rounded-full shadow"
            aria-label="Ke bawah"
            onClick={() => {
              stick.current = true;
              scroller.current!.scrollTo({ top: scroller.current!.scrollHeight, behavior: "smooth" });
            }}
          >
            ↓
          </button>
        )}
      </div>

      {/* Input */}
      <form
        className="border-t border-border px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = input;
          setInput("");
          send(t);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="field max-h-40 min-h-11 flex-1 resize-none"
            rows={1}
            placeholder="Tulis pesan…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn btn-primary" onClick={() => stop()} aria-label="Berhenti">
              ■
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!input.trim()} aria-label="Kirim">
              ➤
            </button>
          )}
        </div>
      </form>

      {drawer && (
        <Drawer
          convs={convs}
          activeId={convId}
          query={query}
          setQuery={setQuery}
          onClose={() => setDrawer(false)}
          onOpen={openConv}
          onNew={newChat}
          onChanged={() => refreshConvs(query)}
          onDeleted={(id) => id === convId && newChat()}
        />
      )}
      {sheet && (
        <ModelSheet
          models={models}
          sel={sel}
          onClose={() => setSheet(false)}
          onPick={(m) => {
            chooseModel(m);
            clearError();
            setSheet(false);
            if (convRef.current) api(`/api/conversations/${convRef.current}`, { method: "PATCH", body: JSON.stringify(m) });
          }}
          onToggleFav={async (m) => {
            setModels((l) => l.map((x) => (x.id === m.id ? { ...x, favorite: !x.favorite } : x)));
            await api("/api/models", { method: "PATCH", body: JSON.stringify({ id: m.id, favorite: !m.favorite }) });
          }}
        />
      )}
    </div>
  );
}

function MessageView(props: {
  m: UIMessage;
  isLast: boolean;
  busy: boolean;
  editing: { id: string; text: string } | null;
  setEditing: (e: { id: string; text: string } | null) => void;
  submitEdit: () => void;
  onRegenerate: () => void;
}) {
  const { m, isLast, busy, editing, setEditing, submitEdit, onRegenerate } = props;
  const [copied, setCopied] = useState(false);
  const text = textOf(m);
  const model = (m.metadata as Meta | undefined)?.model;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (m.role === "user") {
    if (editing)
      return (
        <div className="flex flex-col items-end gap-2">
          <textarea
            className="field min-h-24"
            value={editing.text}
            onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn" onClick={() => setEditing(null)}>
              Batal
            </button>
            <button className="btn btn-primary" onClick={submitEdit}>
              Kirim ulang
            </button>
          </div>
        </div>
      );
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-user-bubble px-4 py-2.5">{text}</div>
        {!busy && (
          <button className="min-h-9 px-2 text-sm text-muted-fg" onClick={() => setEditing({ id: m.id, text })}>
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {text ? <Markdown text={text} /> : <span className="text-muted-fg">…</span>}
      <div className="flex items-center gap-1 text-sm text-muted-fg">
        {model && <span className="mr-2 truncate">{model}</span>}
        <button className="min-h-9 px-2" onClick={copy}>
          {copied ? "Tersalin" : "Salin"}
        </button>
        {isLast && !busy && (
          <button className="min-h-9 px-2" onClick={onRegenerate}>
            Ulangi
          </button>
        )}
      </div>
    </div>
  );
}

function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
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

function ModelSheet(props: {
  models: Model[];
  sel: Sel;
  onClose: () => void;
  onPick: (m: { providerId: string; modelId: string }) => void;
  onToggleFav: (m: Model) => void;
}) {
  const { models, sel, onClose, onPick, onToggleFav } = props;
  const [q, setQ] = useState("");
  const filtered = models.filter((m) => `${m.label} ${m.modelId} ${m.providerName}`.toLowerCase().includes(q.toLowerCase()));
  const favs = filtered.filter((m) => m.favorite);
  const groups = new Map<string, Model[]>();
  for (const m of filtered) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m]);

  const row = (m: Model) => (
    <div key={m.id} className="flex items-center">
      <button
        className={`btn min-w-0 flex-1 justify-start truncate border-0 bg-transparent text-left ${
          sel?.providerId === m.providerId && sel.modelId === m.modelId ? "font-semibold text-accent" : ""
        }`}
        onClick={() => onPick({ providerId: m.providerId, modelId: m.modelId })}
      >
        <span className="truncate">{m.label}</span>
      </button>
      <button
        className="btn border-0 bg-transparent"
        aria-label={m.favorite ? "Hapus favorit" : "Jadikan favorit"}
        onClick={() => onToggleFav(m)}
      >
        {m.favorite ? "★" : "☆"}
      </button>
    </div>
  );

  return (
    <Sheet onClose={onClose} title="Pilih model">
      <div className="px-3 pb-2">
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
            {favs.map(row)}
          </section>
        )}
        {[...groups].map(([name, list]) => (
          <section key={name}>
            <h3 className="px-3 py-1 text-sm text-muted-fg">{name}</h3>
            {list.slice(0, q ? 200 : 60).map(row)}
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

function Drawer(props: {
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
      <aside
        className="flex h-full w-[86%] max-w-sm flex-col bg-background pt-[env(safe-area-inset-top)]"
        onClick={(e) => e.stopPropagation()}
      >
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
                <div className="flex gap-2 px-3 pb-2">
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
        <div className="border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link href="/providers" className="btn w-full">
            Provider &amp; pengaturan
          </Link>
        </div>
      </aside>
    </div>
  );
}
