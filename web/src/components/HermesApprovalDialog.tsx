// Tool-approval modal for the Hermes Agent tab. Renders when the gateway emits
// `approval.request` (an agent tool call needs permission before it can run).
// Responds by choice: Allow once (`allow_once`), Allow always (`approve, all`),
// or Deny (`deny`). Dismissal (backdrop) maps to Deny so a command is never
// left hanging.

import type { ApprovalPrompt } from '../hermes/types';
import type { ApprovalChoice } from '../hermes/useHermes';

export function HermesApprovalDialog({
  prompt,
  onRespond,
}: {
  prompt: ApprovalPrompt;
  onRespond: (choice: ApprovalChoice, all?: boolean) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={() => onRespond('deny')}
    >
      <div
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, maxWidth: 480, width: '90%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Tool approval</div>
        <pre
          style={{
            background: 'var(--inputbg)', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap',
            fontFamily: 'monospace', fontSize: 12, margin: '0 0 12px', color: 'var(--text)',
          }}
        >
          {prompt.command}
        </pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onRespond('deny')}>Deny</button>
          <button className="btn" onClick={() => onRespond('allow_once')}>Allow once</button>
          <button className="btn primary" onClick={() => onRespond('approve', true)}>Allow always</button>
        </div>
      </div>
    </div>
  );
}
