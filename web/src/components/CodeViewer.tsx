import { Suspense, lazy, useState } from 'react';
import { createLowlight, common } from 'lowlight';
import { TextFileEditor } from './TextFileEditor';

// CodeMirror is heavy; load it only when the user actually enters edit mode so the
// main bundle stays lean. The read-only view needs only lowlight (already shared with
// markdown). `CodeEditor` re-exports a named `CodeEditor`, so adapt it to a default.
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

// Read-only code viewer with a VS Code-style chrome: a header (file name,
// language badge, line count, Copy, Edit) over a line-number gutter and a
// token-highlighted body. Reuses the `.codeblock` chrome + `--md-*` token palette
// already used for fenced code blocks inside markdown, so a code file reads the
// same way a highlighted snippet inside a document does.
//
// Highlighting uses `lowlight` (the same engine behind `rehype-highlight`, so the
// grammar bundle is shared, not duplicated). `.registered()` resolves highlight.js
// aliases (py→python, js→javascript, ts→typescript, …). Grammars outside the
// `common` bundle (e.g. scala) simply render plain — the content is still shown,
// it just isn't colored.

// Some file extensions have no grammar of their own but share a language with a
// sibling that does (C headers → cpp, mjs/cjs → javascript, sh → bash, …).
const LANG_ALIAS: Record<string, string> = {
  h: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cc: 'cpp', cxx: 'cpp', m: 'cpp', mm: 'cpp',
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  py: 'python', sh: 'bash', zsh: 'bash', fish: 'bash',
  pl: 'perl', pm: 'perl', fs: 'fsharp', fsx: 'fsharp',
  kt: 'kotlin', kts: 'kotlin', class: 'java',
  htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html', hbs: 'html',
  scss: 'css', less: 'css', sass: 'css', styl: 'css',
};

const lowlight = createLowlight(common);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// lowlight returns a hast tree; shrink it to the subset it ever emits — text and
// `<span class="hljs-…">` elements — and render that to trusted HTML.
type HastNode = { type: string; tagName?: string; properties?: { className?: unknown }; value?: string; children?: HastNode[] };
function hastToHtml(node: HastNode): string {
  if (node.type === 'text') return escapeHtml(node.value ?? '');
  if (node.type === 'root') return (node.children ?? []).map(hastToHtml).join('');
  if (node.type === 'element') {
    const cls = (node.properties?.className ?? []) as string[];
    const attrs = cls.length ? ` class="${cls.join(' ')}"` : '';
    const inner = (node.children ?? []).map(hastToHtml).join('');
    return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
  }
  return '';
}

function highlighted(lang: string, text: string): string {
  if (lang && lowlight.registered(lang)) {
    try {
      return hastToHtml(lowlight.highlight(lang, text));
    } catch {
      // Fall through to a plain escape on any highlight failure.
    }
  }
  return escapeHtml(text);
}

export function CodeViewer({ name, path, text, onSave }: { name: string; path: string; text: string; onSave: (c: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const tooBig = text.length > 1_000_000;
  if (tooBig) {
    // >1 MB of source: highlighting + numbering a megabyte is too costly, so open
    // the plain editor directly. Checked before any line-splitting of `text`.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="codeviewer-large-note">File too large for the highlighted view — editing as plain text.</div>
        <TextFileEditor path={path} initialText={text} onSave={onSave} />
      </div>
    );
  }

  // Binary content (NUL bytes, e.g. a Java `.class`, an image with a code-like
  // name): don't render it as code — show a clean message instead of mojibake.
  if (text.includes('\u0000')) {
    return (
      <div className="viewer-body">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40 }}>🗂️</div>
          <p>This is a binary file and can't be displayed as code.</p>
        </div>
      </div>
    );
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const lang = LANG_ALIAS[ext] ?? ext;
  const lines = text.split('\n').length;

  if (editing) {
    return (
      <Suspense fallback={
        <div className="editor">
          <div className="editor-title"><span>{path}</span><span className="editor-error">Loading editor…</span></div>
        </div>
      }>
        <CodeEditor path={path} value={text} ext={ext} onSave={onSave} />
      </Suspense>
    );
  }

  const gutter = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  const html = highlighted(lang, text);

  const copy = async () => {
    // Strip react-markdown-style trailing newline so the clipboard matches the
    // source the user would paste. Drop the whole copy if there's nothing to copy.
    const source = text.replace(/\n$/, '');
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. permissions) — leave the button as-is.
    }
  };

  return (
    <div className="codeblock codeviewer">
      <div className="codeblock-head">
        <span className="codeviewer-name" title={path}>{name}</span>
        <span className="codeblock-lang">{lang}</span>
        <span className="codeviewer-meta">{lines} lines</span>
        <button type="button" aria-label="Copy code" className="codeblock-copy" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="codeblock-copy" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <div className="codeviewer-body">
        <div className="codeviewer-gutter" aria-hidden="true">{gutter}</div>
        <pre className="codeviewer-code"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
      </div>
    </div>
  );
}
