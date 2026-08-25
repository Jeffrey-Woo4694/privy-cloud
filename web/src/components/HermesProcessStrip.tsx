// Collapsible per-message "process strip" for the Hermes Agent tab. Captures the
// process detail behind a turn that the flat message bubble doesn't: the
// subagent tree (nested by `parentId`), the agent's thinking scratchpad, and its
// visible reasoning. Tools are rendered inline on the message (see the tab's
// ToolCardView); this strip is the collapsible home for the rest.

import type { Message, SubagentNode } from '../hermes/types';

function subagentStatus(status?: string): string {
  if (status === 'ok') return '✓ done';
  if (status === 'error' || status === 'failed') return '✗ failed';
  if (status === 'timeout') return '⏱ timeout';
  return '… running';
}

/// Children of `parentId` (roots when `parentId` is undefined = nodes whose
/// parent isn't present in the set, i.e. the tree's roots).
function childrenOf(nodes: SubagentNode[], parentId: string | undefined): SubagentNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

function SubagentBranch({ nodes, parentId, depth }: { nodes: SubagentNode[]; parentId?: string; depth: number }) {
  const children = childrenOf(nodes, parentId);
  if (children.length === 0) return null;
  return (
    <div style={{ marginLeft: depth ? 14 : 0 }}>
      {children.map((n) => (
        <div key={n.id} style={{ display: 'flex', gap: 6, fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', padding: '1px 0' }}>
          <span style={{ width: 62 }}>{subagentStatus(n.status)}</span>
          <span style={{ color: 'var(--text)', flex: 1 }}>{n.goal || n.id}</span>
          {n.model && <span style={{ opacity: 0.6 }}>({n.model})</span>}
        </div>
      ))}
    </div>
  );
}

export function HermesProcessStrip({ msg }: { msg: Message }) {
  const subagents = msg.subagents ?? [];
  const hasSubagents = subagents.length > 0;
  const hasThinking = !!msg.thinking?.trim();
  const hasReasoning = !!msg.reasoning?.trim();
  if (!hasSubagents && !hasThinking && !hasReasoning) return null;

  // Roots = nodes whose parent isn't present (avoids cycles and orphan cards).
  const ids = new Set(subagents.map((n) => n.id));
  const roots = subagents.filter((n) => !n.parentId || !ids.has(n.parentId));

  return (
    <details className="process-strip" style={{ marginTop: 4 }}>
      <summary style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
        Process{hasSubagents ? ` · ${subagents.length} subagent${subagents.length === 1 ? '' : 's'}` : ''}
        {hasThinking ? ' · thinking' : ''}
        {hasReasoning ? ' · reasoning' : ''}
      </summary>
      <div style={{ paddingTop: 4 }}>
        {hasSubagents && (
          <SubagentBranch nodes={subagents} parentId={undefined} depth={0} />
        )}
        {hasThinking && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Thinking</div>
            <blockquote style={{ margin: 0, fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', borderLeft: '2px solid var(--border)', paddingLeft: 8, overflowWrap: 'anywhere' }}>{msg.thinking}</blockquote>
          </div>
        )}
        {hasReasoning && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Reasoning</div>
            <blockquote style={{ margin: 0, fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', borderLeft: '2px solid var(--border)', paddingLeft: 8, overflowWrap: 'anywhere' }}>{msg.reasoning}</blockquote>
          </div>
        )}
      </div>
    </details>
  );
}
