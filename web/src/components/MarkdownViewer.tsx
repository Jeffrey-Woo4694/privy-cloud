import { Markdown } from './Markdown';

// Read-only rendered preview of a .md file, with an "Edit as markdown" toggle that
// swaps in the raw textarea editor. Mirrors the CodeViewer / StructuredViewer pattern
// (view the formatted content by default, edit the raw source on demand). Rendering
// reuses the shared Markdown renderer, so fenced code blocks, tables, task-lists and
// GFM all look the same as in the Hermes/chat bots.
export function MarkdownViewer({ name, text, onEdit }: { name: string; text: string; onEdit: () => void }) {
  return (
    <div className="mdviewer">
      <div className="mdviewer-head">
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onEdit}>Edit as markdown</button>
      </div>
      <div className="markdown mdviewer-body">
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}
