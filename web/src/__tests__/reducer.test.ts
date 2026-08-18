import { describe, expect, it } from 'vitest';
import {
  applyAgentEvent,
  initialHermesState,
  pushSteer,
  pushUser,
  resyncMessages,
  undoLastTurn,
} from '../hermes/reducer';
import type { AgentEvent, HermesState } from '../hermes/types';

function startTurn(state: HermesState): HermesState {
  return applyAgentEvent(state, { type: 'message.start' });
}

describe('agent-event reducer', () => {
  it('streams and finalizes a message', () => {
    let s = initialHermesState();
    s = pushUser(s, 'fix the test');
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'hel' });
    s = applyAgentEvent(s, { type: 'message.delta', text: 'lo' });
    expect(s.messages[s.messages.length - 1].text).toBe('hello');
    expect(s.streaming).toBe(true);

    s = applyAgentEvent(s, { type: 'message.complete', text: 'hello world', status: 'ok' });
    const last = s.messages[s.messages.length - 1];
    expect(last.streaming).toBe(false);
    expect(last.complete).toBe(true);
    expect(last.text).toBe('hello world');
    expect(s.streaming).toBe(false);
  });

  it('tool cards track lifecycle: start→running, generating no-op, complete→done', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'tool.start', id: 't1', name: 'shell', preview: 'cargo test' });
    expect(s.messages[s.messages.length - 1].tools[0].state).toBe('running');

    // `tool.generating` fires before `tool.start` for the *next* tool and
    // must not flip card state.
    s = applyAgentEvent(s, { type: 'tool.generating', name: 'shell' });
    expect(s.messages[s.messages.length - 1].tools[0].state).toBe('running');

    s = applyAgentEvent(s, { type: 'tool.complete', id: 't1', name: 'shell', ok: true, duration: 1.5, resultPreview: 'ok' });
    const card = s.messages[s.messages.length - 1].tools[0];
    expect(card.state).toBe('done');
    expect(card.ok).toBe(true);
  });

  it('later tool.generating does not uncomplete the previous tool', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'tool.start', id: 't1', name: 'search_files' });
    s = applyAgentEvent(s, { type: 'tool.complete', id: 't1', name: 'search_files', ok: true, duration: 0.2 });
    expect(s.messages[s.messages.length - 1].tools[0].state).toBe('done');

    // Tool 2 starts *generating* its args — its `tool.start` not yet seen.
    s = applyAgentEvent(s, { type: 'tool.generating', name: 'read_file' });
    expect(s.messages[s.messages.length - 1].tools[0].state).toBe('done');
  });

  it('contentless completed turn is popped', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.complete', text: '', status: 'ok' });
    expect(s.messages).toHaveLength(0);
    expect(s.streaming).toBe(false);
  });

  it('whitespace-only completed turn is popped', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.complete', text: '  \n\t ', status: 'ok' });
    expect(s.messages).toHaveLength(0);
  });

  it('complete with content is kept', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.complete', text: 'real answer', status: 'ok' });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toBe('real answer');
  });

  it('complete with tools is kept (the card is content)', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'tool.start', id: 't1', name: 'shell', preview: 'ls' });
    s = applyAgentEvent(s, { type: 'message.complete', text: '', status: 'ok' });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].tools).toHaveLength(1);
  });

  it('contentless streaming turn is superseded by a new start', () => {
    let s = initialHermesState();
    s = startTurn(s); // first start — empty streaming
    s = startTurn(s); // second start — the first is abandoned
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].streaming).toBe(true);
  });

  it('streaming with content survives a new start', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'partial' });
    s = startTurn(s);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].text).toBe('partial');
  });

  it('live delegation complete is dropped', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, {
      type: 'message.complete',
      text: '[ASYNC DELEGATION BATCH COMPLETE — deleg_38e8729d]\nconsolidated…',
      status: 'ok',
    });
    expect(s.messages).toHaveLength(0);
    expect(s.streaming).toBe(false);
  });

  it('delegation plumbing delta is dropped mid-stream', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: '[ASYNC DELEGATION BATCH ' });
    expect(s.messages).toHaveLength(1); // marker not fully present yet

    s = applyAgentEvent(s, { type: 'message.delta', text: 'COMPLETE — deleg_1]\n…' });
    expect(s.messages).toHaveLength(0); // popped once the marker is recognized

    // Subsequent deltas/completes for the dropped message are no-ops.
    s = applyAgentEvent(s, { type: 'message.delta', text: 'more' });
    s = applyAgentEvent(s, { type: 'message.complete', text: 'more', status: 'ok' });
    expect(s.messages).toHaveLength(0);
  });

  it('errored contentless turn is popped', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'error', message: 'boom' });
    expect(s.messages).toHaveLength(0);
    expect(s.streaming).toBe(false);
  });

  it('errored turn with content is kept', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'partial' });
    s = applyAgentEvent(s, { type: 'error', message: 'boom' });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toBe('partial');
    expect(s.messages[0].streaming).toBe(false);
    expect(s.messages[0].complete).toBe(true);
    expect(s.status).toBe('error: boom');
  });

  it('message.complete with error status records the errored turn', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'oops' });
    s = applyAgentEvent(s, { type: 'message.complete', text: 'oops', status: 'error' });
    expect(s.status).toBe('last turn errored');
    expect(s.messages).toHaveLength(1);
    expect(s.streaming).toBe(false);
  });

  it('status.update sets the status line', () => {
    const s = applyAgentEvent(initialHermesState(), { type: 'status.update', text: 'working…' });
    expect(s.status).toBe('working…');
  });

  it('pushUser adds a completed user message', () => {
    const s = pushUser(initialHermesState(), 'hello');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[0].text).toBe('hello');
    expect(s.messages[0].complete).toBe(true);
    expect(s.messages[0].streaming).toBe(false);
    expect(s.nextMessageId).toBe(2);
  });

  it('pushSteer adds a distinct steer note', () => {
    const s = pushSteer(initialHermesState(), 'turn left at the light');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('steer');
    expect(s.messages[0].text).toBe('turn left at the light');
    expect(s.messages[0].complete).toBe(true);
    expect(s.messages[0].streaming).toBe(false);
  });

  it('undoLastTurn removes steer + assistant (with its tool card) + user', () => {
    let s = initialHermesState();
    s = pushUser(s, 'q1');
    s = pushUser(s, 'q2');
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'a2' });
    s = applyAgentEvent(s, { type: 'tool.start', id: 't1', name: 'shell' });
    s = applyAgentEvent(s, { type: 'message.complete', text: 'a2', status: 'ok' });
    s = pushSteer(s, 'focus');
    // messages: q1(U), q2(U), a2(A with the shell card), focus(Steer)
    expect(s.messages).toHaveLength(4);
    expect(s.messages[2].tools).toHaveLength(1);

    s = undoLastTurn(s);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[0].text).toBe('q1');

    s = undoLastTurn(s);
    expect(s.messages).toHaveLength(0);

    s = undoLastTurn(s);
    expect(s.messages).toHaveLength(0);
  });

  it('resyncMessages rebuilds from history and attaches tool cards', () => {
    // A stale, streaming transcript left over from a dropped connection.
    let s = initialHermesState();
    s = pushUser(s, 'old user text');
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'stale delta' });
    expect(s.streaming).toBe(true);

    s = resyncMessages(s, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
      { role: 'tool', text: '', toolName: 'shell', toolContext: '{"cmd":"cargo build"}' },
    ]);

    expect(s.streaming).toBe(false);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[0].text).toBe('hello');
    expect(s.messages[0].complete).toBe(true);

    const assistant = s.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.text).toBe('hi there');
    expect(assistant.tools).toHaveLength(1);
    expect(assistant.tools[0].name).toBe('shell');
    expect(assistant.tools[0].preview).toBe('{"cmd":"cargo build"}');
    expect(assistant.tools[0].state).toBe('done');
    expect(assistant.tools[0].ok).toBe(true);
  });

  it('resyncMessages skips batch delegation plumbing', () => {
    const s = resyncMessages(initialHermesState(), [
      { role: 'user', text: "What's in the project?" },
      {
        role: 'user',
        text: '[ASYNC DELEGATION BATCH COMPLETE — deleg_38e8729d]\nA background fan-out of 2 subagent(s)…',
      },
      { role: 'assistant', text: 'And there they are.' },
    ]);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].text).toBe("What's in the project?");
    expect(s.messages[1].text).toBe('And there they are.');
  });

  it('resyncMessages skips the single-subagent delegation marker', () => {
    const s = resyncMessages(initialHermesState(), [
      { role: 'user', text: '[ASYNC DELEGATION COMPLETE — deleg_abc123]\nOriginal goal: search the web' },
    ]);
    expect(s.messages).toHaveLength(0);
  });

  it('deferred events are clean no-ops', () => {
    let s = initialHermesState();
    s = pushUser(s, 'q');
    const noops: AgentEvent[] = [
      { type: 'gateway.ready' },
      { type: 'session.info', model: 'm', provider: 'p' },
      { type: 'session.title', sessionId: 's', title: 'T' },
      { type: 'thinking.delta', text: 'x' },
      { type: 'reasoning.delta', text: 'y' },
      { type: 'reasoning.available', text: 'z' },
      { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' },
      { type: 'subagent.complete', id: 'sa1', status: 'ok' },
      { type: 'approval.request', id: 'r1', payload: {} },
      { type: 'clarify.request', id: 'c1', question: 'q', choices: [] },
      { type: 'unknown', eventType: 'whatever', payload: {} },
    ];
    for (const ev of noops) {
      const after = applyAgentEvent(s, ev);
      expect(after).toBe(s); // same reference — a true no-op
    }
  });

  it('reducer is immutable: pushUser does not mutate the input state', () => {
    const s0 = initialHermesState();
    const s1 = pushUser(s0, 'hello');
    expect(s0.messages).toHaveLength(0);
    expect(s0.nextMessageId).toBe(1);
    expect(s1.messages).toHaveLength(1);
    expect(s1.nextMessageId).toBe(2);
  });

  it('reducer is immutable: deltas do not mutate the original message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    const before = s.messages[0];
    const next = applyAgentEvent(s, { type: 'message.delta', text: 'hi' });

    expect(s.messages[0].text).toBe('');
    expect(next.messages[0].text).toBe('hi');
    expect(s.messages[0]).toBe(before); // original object untouched
    expect(next.messages[0]).not.toBe(before); // a new object
    expect(s.streaming).toBe(true);
  });

  it('reducer is immutable: message.complete does not mutate the streaming message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'hi' });
    const orig = s.messages[0];
    const after = applyAgentEvent(s, { type: 'message.complete', text: 'hi world', status: 'ok' });

    expect(orig.text).toBe('hi');
    expect(orig.streaming).toBe(true);
    expect(orig.complete).toBe(false);
    expect(after.messages[0].text).toBe('hi world');
    expect(after.messages[0].streaming).toBe(false);
    expect(after.messages[0].complete).toBe(true);
  });

  it('reducer is immutable: error does not mutate the streaming message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'hi' });
    const orig = s.messages[0];
    const after = applyAgentEvent(s, { type: 'error', message: 'boom' });

    expect(orig.streaming).toBe(true);
    expect(orig.complete).toBe(false);
    expect(after.messages[0].streaming).toBe(false);
    expect(after.messages[0].complete).toBe(true);
    expect(after.status).toBe('error: boom');
  });

  it('tool.start with no open assistant message creates a card-holder message', () => {
    const s = applyAgentEvent(initialHermesState(), { type: 'tool.start', id: 't1', name: 'shell' });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('assistant');
    expect(s.messages[0].streaming).toBe(false);
    expect(s.messages[0].complete).toBe(false);
    expect(s.messages[0].tools[0].state).toBe('running');
    expect(s.nextMessageId).toBe(2);
  });

  it('message.complete with no streaming message only flips streaming/status', () => {
    const s = pushUser(initialHermesState(), 'q');
    const before = s.messages;
    const after = applyAgentEvent(s, { type: 'message.complete', text: 'orphan', status: 'error' });

    expect(after.messages).toBe(before); // messages array untouched
    expect(after.streaming).toBe(false);
    expect(after.status).toBe('last turn errored');
  });

  it('tool.complete with unknown id is a no-op (same reference)', () => {
    let s = initialHermesState();
    s = startTurn(s);
    const after = applyAgentEvent(s, { type: 'tool.complete', id: 'ghost', name: 'x', ok: true });
    expect(after).toBe(s);
  });

  it('resyncMessages preserves sessionId/sessionKey/title', () => {
    const s = { ...initialHermesState(), sessionId: 'live1', sessionKey: 'stored1', title: 'My title' };
    const out = resyncMessages(s, [{ role: 'user', text: 'hi' }]);
    expect(out.sessionId).toBe('live1');
    expect(out.sessionKey).toBe('stored1');
    expect(out.title).toBe('My title');
    expect(out.messages[0].text).toBe('hi');
  });
});
