"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { api, errorText } from "./chat/api";
import { MAX_IMAGES, MAX_TOTAL_IMAGE_CHARS, readAttachment, textAttachmentPart, type Attachment } from "./chat/attachments";
import Drawer, { type Conv } from "./chat/Drawer";
import MessageView, { textOf } from "./chat/MessageView";
import { ModelSheet, type Model, type PersonaOpt, type Sel } from "./chat/Sheets";

const LAST_KEY = "llm-pribadi:last-model";
const THEME_KEY = "llm-pribadi:theme";

type PrefsLite = { theme: "system" | "light" | "dark"; personas: PersonaOpt[]; activePersonaId: string | null };

// Klien hanya mengirim pesan terbaru + id riwayat; server membaca sisanya dari database.
const transport = new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: { ...body, history: messages.slice(0, -1).map((m) => m.id), message: messages[messages.length - 1] },
  }),
});

function applyTheme(t: PrefsLite["theme"]) {
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
  const [prefs, setPrefs] = useState<PrefsLite>({ theme: "system", personas: [], activePersonaId: null });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachNote, setAttachNote] = useState("");

  const convRef = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    convRef.current = convId;
  }, [convId]);

  const { messages, setMessages, sendMessage, regenerate, stop, status, error, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  // Salinan terbaru untuk handler yang berjalan di luar render (mis. visibilitychange).
  const live = useRef({ status, messages });
  useEffect(() => {
    live.current = { status, messages };
  });

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
    setAttachments([]);
    clearError();
    window.history.replaceState(null, "", "/");
    setDrawer(false);
  }, [stop, setMessages, clearError]);

  // Muat awal
  useEffect(() => {
    (async () => {
      const [list, p] = await Promise.all([api<Model[]>("/api/models"), api<PrefsLite>("/api/settings").catch(() => null)]);
      if (p && Array.isArray(p.personas)) {
        setPrefs({ theme: p.theme, personas: p.personas, activePersonaId: p.activePersonaId });
        applyTheme(p.theme);
      }
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

  // Judul otomatis dibuat server di latar belakang; segarkan daftar sebentar setelah balasan selesai.
  useEffect(() => {
    if (status !== "ready" || messages.length !== 2) return;
    const t = setTimeout(() => refreshConvs(query), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages.length]);

  // Saat tab kembali aktif (mis. HP di-background lalu dibuka lagi), sinkronkan dengan yang tersimpan di server.
  useEffect(() => {
    async function sync() {
      const id = convRef.current;
      if (document.visibilityState !== "visible" || !id) return;
      const streaming = () => live.current.status === "streaming" || live.current.status === "submitted";
      if (streaming()) return;
      try {
        const c = await api<{ id?: string; messages?: UIMessage[] }>(`/api/conversations/${id}`);
        if (!c?.messages || convRef.current !== id) return;
        if (streaming()) return;
        const cur = live.current.messages;
        const a = c.messages[c.messages.length - 1];
        const b = cur[cur.length - 1];
        if (c.messages.length !== cur.length || a?.id !== b?.id || (a && b && textOf(a) !== textOf(b))) setMessages(c.messages);
      } catch {}
    }
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [setMessages]);

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

  const reqBody = () => ({ id: convRef.current, providerId: sel?.providerId, modelId: sel?.modelId });

  async function send(text: string, files: Attachment[] = []) {
    const t = text.trim();
    if ((!t && files.length === 0) || busy) return;
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
    const parts: UIMessage["parts"] = [];
    for (const a of files) {
      if (a.kind === "text") parts.push({ type: "text", text: textAttachmentPart(a) });
      else parts.push({ type: "file", mediaType: a.mediaType, url: a.url, filename: a.name });
    }
    if (t) parts.push({ type: "text", text: t });
    await sendMessage({ role: "user", parts }, { body: reqBody() });
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setAttachNote("");
    const next = [...attachments];
    for (const f of Array.from(list)) {
      try {
        const a = await readAttachment(f);
        if (a.kind === "image") {
          const imgs = next.filter((x) => x.kind === "image");
          const total = imgs.reduce((n, x) => n + (x.kind === "image" ? x.url.length : 0), 0) + a.url.length;
          if (imgs.length >= MAX_IMAGES) throw new Error(`Maksimal ${MAX_IMAGES} gambar per pesan.`);
          if (total > MAX_TOTAL_IMAGE_CHARS) throw new Error("Total ukuran gambar terlalu besar. Kurangi jumlah gambar.");
        }
        next.push(a);
      } catch (e) {
        setAttachNote((e as Error).message);
      }
    }
    setAttachments(next);
    if (fileInput.current) fileInput.current.value = "";
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

  const onRegenerate = () => {
    if (!sel) return setSheet(true);
    regenerate({ body: reqBody() });
  };

  async function setPersona(id: string | null) {
    setPrefs((p) => ({ ...p, activePersonaId: id }));
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ activePersonaId: id }) });
  }

  const current = models.find((m) => m.providerId === sel?.providerId && m.modelId === sel?.modelId);
  const modelName = current?.label ?? sel?.modelId ?? "Pilih model";
  const persona = prefs.personas.find((p) => p.id === prefs.activePersonaId);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const errMsg = error ? errorText(error.message) : "";

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <button className="btn border-0 bg-transparent" aria-label="Riwayat" onClick={() => setDrawer(true)}>
          ☰
        </button>
        <button className="btn min-w-0 flex-1 justify-center truncate" onClick={() => setSheet(true)} aria-label="Ganti model">
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
                <>
                  <p>Mulai percakapan dengan {modelName}.</p>
                  {persona && <p className="mt-1 text-sm">Persona: {persona.name}</p>}
                </>
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
              onRegenerate={onRegenerate}
            />
          ))}

          {status === "submitted" && <p className="text-muted-fg">Berpikir…</p>}

          {error && (
            <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3">
              <p>{errMsg}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href="/providers" className="btn">
                  Periksa key
                </Link>
                <button className="btn" onClick={() => setSheet(true)}>
                  Pilih model lain
                </button>
                {/tidak sinkron/i.test(errMsg) && convId ? (
                  <button className="btn" onClick={() => openConv(convId)}>
                    Muat ulang percakapan
                  </button>
                ) : (
                  <button className="btn" onClick={onRegenerate}>
                    Coba lagi
                  </button>
                )}
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
          const files = attachments;
          if (!t.trim() && files.length === 0) return;
          setInput("");
          setAttachments([]);
          setAttachNote("");
          send(t, files);
        }}
      >
        <div className="mx-auto max-w-3xl">
          {(attachments.length > 0 || attachNote) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-xl border border-border bg-muted py-1 pl-2 pr-1 text-sm">
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    "📎"
                  )}
                  <span className="max-w-32 truncate">{a.name}</span>
                  <button
                    type="button"
                    className="min-h-8 min-w-8"
                    aria-label={`Hapus ${a.name}`}
                    onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {attachNote && <span className="text-sm text-red-500">{attachNote}</span>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,text/*,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.sh,.sql,.yml,.yaml,.toml,.log,.html,.css,.xml"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button type="button" className="btn border-0 bg-transparent" aria-label="Lampirkan berkas" disabled={busy} onClick={() => fileInput.current?.click()}>
              📎
            </button>
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
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
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
              <button className="btn btn-primary" disabled={!input.trim() && attachments.length === 0} aria-label="Kirim">
                ➤
              </button>
            )}
          </div>
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
          personas={prefs.personas}
          activePersonaId={prefs.activePersonaId}
          onPersona={setPersona}
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
