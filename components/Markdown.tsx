"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

function langOf(children: ReactNode): string | null {
  const el = Array.isArray(children) ? children[0] : children;
  const cls = (el as { props?: { className?: string } } | null)?.props?.className ?? "";
  return /language-([\w-]+)/.exec(cls)?.[1] ?? null;
}

function Pre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = langOf(children);
  return (
    <div className="relative">
      {lang && <span className="absolute left-3 top-1 select-none font-mono text-xs text-muted-fg">{lang}</span>}
      <pre className={`overflow-x-auto rounded-xl bg-muted p-3 pr-16 font-mono text-sm ${lang ? "pt-7" : ""}`}>{children}</pre>
      <button
        type="button"
        className="absolute right-1 top-1 min-h-9 rounded-lg border border-border bg-background px-3 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

// memo: saat streaming, pesan lama tidak perlu di-parse ulang di setiap token.
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={{ pre: Pre }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
