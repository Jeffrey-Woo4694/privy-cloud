import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedAutosave } from '../useDebouncedAutosave';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

// A code editor for the CodeViewer's edit mode: syntax highlighting + line numbers
// preserved (the read-only view's "text style" doesn't disappear), filling the whole
// surface. Reuses the app's --md-* token palette so it reads like the viewer, and
// backfills backups on save just like the markdown/text editors.

function languageFor(ext: string): LanguageSupport | null {
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'py': return python();
    case 'cpp': case 'c': case 'cc': case 'cxx': case 'h': case 'hpp': case 'hh': case 'hxx': case 'm': case 'mm': return cpp();
    case 'java': case 'class': return java();
    case 'go': return go();
    case 'rs': return rust();
    case 'html': case 'htm': case 'xhtml': case 'vue': case 'svelte': return html();
    case 'css': case 'scss': case 'less': case 'sass': case 'styl': return css();
    default: return null; // still editable, with line numbers, just not token-colored
  }
}

// HighlightStyle driven by the app's --md-* CSS variables (as var() strings, so the
// colors follow the light/dark theme automatically, matching the read-only view + fenced
// markdown blocks).
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--md-keyword)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--md-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--md-number)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--md-attr)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--md-function)' },
  { tag: [tags.name, tags.definition(tags.name)], color: 'var(--md-builtin)' },
  { tag: [tags.comment, tags.quote], color: 'var(--md-comment)', fontStyle: 'italic' },
  { tag: [tags.literal, tags.operator, tags.logicOperator], color: 'var(--md-literal)' },
  { tag: [tags.typeName, tags.className], color: 'var(--md-type)' },
  { tag: tags.variableName, color: 'var(--md-variable)' },
  { tag: tags.meta, color: 'var(--md-meta)' },
]);

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--md-code-fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto', fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '13px', lineHeight: '1.55',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--code-head-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.08)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(127, 127, 127, 0.08)' },
}, { dark: true });

export function CodeEditor({ path, value, ext, onSave }: { path: string; value: string; ext: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const theme = useMemo(() => [baseTheme, syntaxHighlighting(codeHighlight)], []);
  const extensions = useMemo(() => {
    const lang = languageFor(ext);
    return lang ? [lang] : [];
  }, [ext]);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave(content); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch (e) { setError((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Autosave ~1.2s after the last keystroke; each save is backed up server-side.
  // Pending edits also flush if the editor unmounts mid-debounce (e.g. Esc closes
  // the viewer), so a keystroke is never lost.
  const scheduleAutosave = useDebouncedAutosave(save);

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving} title="Ctrl+S">{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <div className="codeeditor-mount">
        <CodeMirror
          value={content}
          onChange={(v) => { setContent(v); scheduleAutosave(); }}
          height="100%"
          theme={theme}
          extensions={extensions}
          basicSetup={{ lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true, foldGutter: false }}
        />
      </div>
    </div>
  );
}
