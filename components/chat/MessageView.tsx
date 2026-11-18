"use client";

import { memo, useState } from "react";
import type { UIMessage } from "ai";
import Markdown from "../Markdown";
import { ATTACH_MARK } from "./attachments";

type Meta = { model?: string | null; usage?: { in?: number; out?: number } };

export function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

type Props = {
  m: UIMessage;
  isLast: boolean;
  busy: boolean;
  editing: { id: string; text: string } | null;
  setEditing: (e: { id: string; text: string } | null) => void;
  submitEdit: () => void;
  onRegenerate: () => void;
};

function MessageViewImpl({ m, isLast, busy, editing, setEditing, submitEdit, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const text = textOf(m);
  const meta = m.metadata as Meta | undefined;
  const model = meta?.model;
  const usage = meta?.usage;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  if (m.role === "user") {
    if (editing)
      return (
        <div className="flex flex-col items-end gap-2">
          <textarea className="field min-h-24" value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} autoFocus />
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

    const hasImages = m.parts.some((p) => p.type === "file");
    return (
      <div className="flex flex-col items-end gap-1">
        {m.parts.map((p, i) => {
          if (p.type === "file" && p.mediaType.startsWith("image/"))
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={i} src={p.url} alt={p.filename ?? "gambar"} className="max-h-60 max-w-[88%] rounded-2xl object-cover" />;
          if (p.type !== "text" || !p.text.trim()) return null;
          const mark = ATTACH_MARK.exec(p.text);
          if (mark)
            return (
              <details key={i} className="max-w-[88%] rounded-2xl bg-user-bubble px-4 py-2">
                <summary className="cursor-pointer truncate">📎 {mark[1]}</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-sm">
                  {p.text.slice(mark[0].length).replace(/^`{3,}\n?|\n?`{3,}$/g, "")}
                </pre>
              </details>
            );
          return (
            <div key={i} className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-user-bubble px-4 py-2.5">
              {p.text}
            </div>
          );
        })}
        {!busy && !hasImages && (
          <button className="min-h-9 px-2 text-sm text-muted-fg" onClick={() => setEditing({ id: m.id, text })}>
            Edit
          </button>
        )}
      </div>
    );
  }

  const reasoning = m.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => (p.type === "reasoning" ? p.text : ""))
    .join("\n\n")
    .trim();

  return (
    <div className="flex flex-col gap-1">
      {reasoning && (
        <details className="rounded-xl border border-border px-3 py-2 text-sm text-muted-fg">
          <summary className="cursor-pointer">Proses berpikir</summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{reasoning}</p>
        </details>
      )}
      {text ? <Markdown text={text} /> : !reasoning && <span className="text-muted-fg">…</span>}
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-fg">
        {model && <span className="mr-2 max-w-[50%] truncate">{model}</span>}
        {usage && (usage.in !== undefined || usage.out !== undefined) && (
          <span className="mr-2 whitespace-nowrap" title="Token masuk / keluar">
            ↑{usage.in ?? "?"} ↓{usage.out ?? "?"}
          </span>
        )}
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

export default memo(MessageViewImpl);
