import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// react-markdown never renders raw HTML (no rehype-raw), so user/model text is
// XSS-safe. We map each block to the editor's type scale instead of pulling in
// the Tailwind typography plugin.
const COMPONENTS: Components = {
  p: (props) => <p className="text-[13px] leading-relaxed [&:not(:first-child)]:mt-2" {...props} />,
  a: (props) => (
    <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
  ),
  strong: (props) => <strong className="font-semibold" {...props} />,
  ul: (props) => <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed" {...props} />,
  ol: (props) => <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed" {...props} />,
  li: (props) => <li className="[&>ul]:mt-1 [&>ol]:mt-1" {...props} />,
  h1: (props) => <h1 className="mt-3 text-[15px] font-semibold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-3 text-[14px] font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-2.5 text-[13px] font-semibold first:mt-0" {...props} />,
  blockquote: (props) => (
    <blockquote className="mt-2 border-l-2 border-border pl-3 text-[13px] text-muted-foreground" {...props} />
  ),
  hr: (props) => <hr className="my-3 border-border" {...props} />,
  pre: (props) => (
    <pre
      className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px] leading-relaxed"
      {...props}
    />
  ),
  table: (props) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" {...props} />
    </div>
  ),
  th: (props) => <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium" {...props} />,
  td: (props) => <td className="border border-border px-2 py-1 align-top" {...props} />,
};

// All code is monospaced; only inline code (not inside a `pre`) gets the chip
// background, so fenced blocks don't double up on the `pre` background.
const CODE = "[&_code]:font-mono [&_code]:text-[11.5px] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5";

/** GFM markdown, rendered with the editor's type scale. Raw HTML is never emitted. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className={`min-w-0 break-words ${CODE}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
