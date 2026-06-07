import { Fragment, type ReactNode } from "react";

const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`/g;

/** Minimal, XSS-safe inline markdown: **bold** and `code` only. */
export function Markdown({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) {
      parts.push(<b key={key++}>{m[1]}</b>);
    } else {
      parts.push(
        <code key={key++} className="rounded bg-secondary px-1 py-0.5 font-mono text-[11.5px]">
          {m[2]}
        </code>,
      );
    }
    last = TOKEN.lastIndex;
  }
  TOKEN.lastIndex = 0;
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);

  return <p className="text-[13px] leading-relaxed">{parts}</p>;
}
