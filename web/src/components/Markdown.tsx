// Shared markdown renderer for agent-generated text (Hermes tab + chat bot).
//
// `react-markdown` is safe-by-default: it does NOT render raw HTML (no
// `rehype-raw`), so anything the agent emits as markup is shown literally
// rather than executed. `remark-gfm` covers tables / task-lists / strikethrough;
// `rehype-highlight` colors fenced code blocks with lowlight's common languages.
//
// Fenced code blocks get a "beautiful" header — the language label plus a copy
// button ("Copy" → "Copied ✓") — which is the signature element of the design;
// everything else is quiet and driven by the app's CSS tokens in theme.css.

import { useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/// One highlighted fenced code block. `children` are rehype-highlight's token
/// spans; a ref over the `<code>` node captures the raw source for the clipboard,
/// independent of the highlighting (which adds classes but no text).
function CodeBlock({ lang, className, children }: { lang: string; className?: string; children: ReactNode }) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // `innerText` (browser) or `textContent` (jsdom fallback) is the literate
    // source; strip react-markdown's trailing newline so the clipboard matches
    // what the user would paste.
    const text = (codeRef.current?.innerText ?? codeRef.current?.textContent ?? '').replace(/\n$/, '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. permissions) — leave the button as-is.
    }
  };

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{lang}</span>
        <button type="button" aria-label="Copy code" className="codeblock-copy" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre>
        <code ref={codeRef} className={className}>{children}</code>
      </pre>
    </div>
  );
}

// Override `pre` to strip the wrapper react-markdown adds around a fenced block —
// the `code` component below owns its own `<pre>`. Non-fenced (inline) code is not
// wrapped in `pre`, so it is unaffected.
const components: Components = {
  pre({ children }) {
    // A fenced block WITH a language is rendered by the `code` component below
    // (which owns its own <pre>). Anything untagged — an indented block, or a
    // fence the agent emitted without a language — keeps a real <pre> so line
    // breaks survive (the `md-plain` class styles only this path).
    const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string } } | undefined;
    const cls = child?.props?.className ?? '';
    return /language-/.test(cls) ? <>{children}</> : <pre className="md-plain">{children}</pre>;
  },
  code({ className, children }) {
    const match = /language-([\w-]+)/.exec(className ?? '');
    if (!match) return <code className={className}>{children}</code>;
    return <CodeBlock lang={match[1]} className={className}>{children}</CodeBlock>;
  },
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
