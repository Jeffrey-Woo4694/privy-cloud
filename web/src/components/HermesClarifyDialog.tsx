// Clarifying-question modal for the Hermes Agent tab. Renders when the gateway
// emits `clarify.request` (the agent needs an answer before continuing). Choice
// buttons fill + submit the input; a manual answer can be typed. Dismissal
// (Cancel) submits an empty answer so the agent is never left waiting.

import { useState } from 'react';
import type { ClarifyPrompt } from '../hermes/types';

export function HermesClarifyDialog({
  prompt,
  onRespond,
}: {
  prompt: ClarifyPrompt;
  onRespond: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState('');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
    >
      <div
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, maxWidth: 480, width: '90%' }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Ask Hermes</div>
        <div style={{ marginBottom: 10 }}>{prompt.question}</div>
        {prompt.choices.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {prompt.choices.map((c) => (
              <button key={c} className="btn" onClick={() => onRespond(c)}>{c}</button>
            ))}
          </div>
        )}
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim()) onRespond(answer); }}
          placeholder="Your answer"
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)', marginBottom: 10 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onRespond('')}>Cancel</button>
          <button className="btn primary" disabled={!answer.trim()} onClick={() => onRespond(answer)}>Submit</button>
        </div>
      </div>
    </div>
  );
}
