"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

function Pre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-muted p-3 pr-16 font-mono text-sm">{children}</pre>
      <button
        type="button"
        className="absolute right-1 top-1 min-h-9 rounded-lg border border-border bg-background px-3 text-xs"
        onClick={async () => {
          await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ""));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: Pre }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
