import { describe, expect, it } from 'vitest';
import {
  addAttachment,
  applyAgentEvent,
  clearAttachments,
  initialHermesState,
  pushAssistant,
  pushSteer,
  pushUser,
  removeAttachment,
  resyncMessages,
  stallTurn,
  takeAttachments,
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
    expect(card.duration).toBe(1.5);
    expect(card.resultPreview).toBe('ok');
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

  it('pushAssistant adds a completed assistant message', () => {
    const s = pushAssistant(initialHermesState(), 'slash output');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('assistant');
    expect(s.messages[0].text).toBe('slash output');
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

    const out = resyncMessages(s, [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
      { role: 'tool', text: '', toolName: 'shell', toolContext: '{"cmd":"cargo build"}' },
    ]);

    expect(out.streaming).toBe(false);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe('user');
    expect(out.messages[0].text).toBe('hello');
    expect(out.messages[0].complete).toBe(true);

    const assistant = out.messages[1];
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

  it('resyncMessages drops the model-switch marker', () => {
    const s = resyncMessages(initialHermesState(), [
      { role: 'user', text: 'hello' },
      {
        role: 'user',
        text: '[System: The active model for this chat has changed to deepseek-v4-flash via provider custom. From this point forward, use this runtime metadata.]',
      },
      { role: 'assistant', text: 'done' },
    ]);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].text).toBe('hello');
    expect(s.messages[1].text).toBe('done');
  });

  it('thinking buffers before message.start, then commits into the message', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'thinking.delta', text: 'step one ' });
    s = applyAgentEvent(s, { type: 'thinking.delta', text: 'step two' });
    expect(s.messages).toHaveLength(0); // still buffered
    expect(s.pendingThinking).toBe('step one step two');

    s = startTurn(s);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].thinking).toBe('step one step two');
    expect(s.messages[0].reasoning).toBeUndefined();
    expect(s.pendingThinking).toBe(''); // cleared after commit
  });

  it('thinking during a streaming turn appends to that message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'thinking.delta', text: 'a' });
    s = applyAgentEvent(s, { type: 'thinking.delta', text: 'b' });
    expect(s.messages[0].thinking).toBe('ab');
  });

  it('reasoning.delta appends to an open streaming message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'reasoning.delta', text: 'scratch ' });
    s = applyAgentEvent(s, { type: 'reasoning.delta', text: 'notes' });
    expect(s.messages[0].reasoning).toBe('scratch notes');
  });

  it('reasoning.available replaces accumulated deltas (buffer before start)', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'reasoning.delta', text: 'scratch' });
    s = applyAgentEvent(s, { type: 'reasoning.available', text: 'final reasoning' });
    s = startTurn(s);
    expect(s.messages[0].reasoning).toBe('final reasoning');
  });

  it('reasoning.available attaches to the current message during streaming and does not leak', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'reasoning.delta', text: 'partial' });
    s = applyAgentEvent(s, { type: 'reasoning.available', text: 'canonical' });
    expect(s.messages[0].reasoning).toBe('canonical');
    expect(s.messages[0].thinking).toBeUndefined();

    // Next turn starts with a clean reasoning field.
    s = applyAgentEvent(s, { type: 'message.complete', text: 'done', status: 'ok' });
    s = startTurn(s);
    expect(s.messages[1].reasoning).toBeUndefined();
  });

  it('a message with thinking is not contentless (kept on complete)', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'thinking.delta', text: 'thought' });
    s = applyAgentEvent(s, { type: 'message.complete', text: '', status: 'ok' });
    // The turn has thinking, so it must NOT be popped as contentless.
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].thinking).toBe('thought');
    expect(s.messages[0].subagents).toEqual([]);
  });

  it('subagent.start pushes a node; message.start clears the live list', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', parentId: 'root', depth: 1, goal: 'search', model: 'gpt-5' });
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ id: 'sa1', parentId: 'root', depth: 1, goal: 'search', model: 'gpt-5' });

    s = startTurn(s);
    expect(s.subagents).toHaveLength(0);
  });

  it('duplicate subagent.start is ignored', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' });
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' });
    expect(s.subagents).toHaveLength(1);
  });

  it('message.complete snapshots subagents into the message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' });
    s = applyAgentEvent(s, { type: 'subagent.complete', id: 'sa1', status: 'ok' });
    s = applyAgentEvent(s, { type: 'message.complete', text: 'answer', status: 'ok' });
    const last = s.messages[s.messages.length - 1];
    expect(last.subagents).toHaveLength(1);
    expect(last.subagents![0].status).toBe('ok');
  });

  it('subagent.complete after message.complete updates the snapshot (async delegation)', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'reasoning.delta', text: 'delegating' });
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' });
    // Turn completes while the subagent is still running (status undefined).
    s = applyAgentEvent(s, { type: 'message.complete', text: 'delegating', status: 'ok' });
    const before = s.messages[s.messages.length - 1].subagents![0];
    expect(before.status).toBeUndefined();

    // Background subagent finishes after the turn.
    s = applyAgentEvent(s, { type: 'subagent.complete', id: 'sa1', status: 'ok' });
    const after = s.messages[s.messages.length - 1].subagents![0];
    expect(after.status).toBe('ok');
  });

  it('subagent.complete ignores unknown ids', () => {
    const before = initialHermesState();
    const s = applyAgentEvent(before, { type: 'subagent.complete', id: 'ghost', status: 'ok' });
    expect(s).toBe(before); // nothing to attach to — same reference
    expect(s.subagents).toHaveLength(0);
  });

  it('error snapshots subagents into the message', () => {
    let s = initialHermesState();
    s = startTurn(s);
    s = applyAgentEvent(s, { type: 'message.delta', text: 'partial' });
    s = applyAgentEvent(s, { type: 'subagent.start', id: 'sa1', depth: 0, goal: 'g' });
    s = applyAgentEvent(s, { type: 'subagent.complete', id: 'sa1', status: 'ok' });
    s = applyAgentEvent(s, { type: 'error', message: 'boom' });
    const last = s.messages[s.messages.length - 1];
    expect(last.text).toBe('partial');
    expect(last.subagents).toHaveLength(1);
    expect(last.subagents![0].status).toBe('ok');
  });

  it('approval.request sets pendingApproval with a default command', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'approval.request', id: 'r1', payload: {} });
    expect(s.pendingApproval).toMatchObject({ id: 'r1', command: 'approve this tool call' });

    s = applyAgentEvent(s, { type: 'approval.request', id: 'r2', command: 'cargo test', tool: 'shell', payload: {} });
    expect(s.pendingApproval).toMatchObject({ id: 'r2', command: 'cargo test', tool: 'shell' });
  });

  it('clarify.request sets pendingClarify', () => {
    const s = applyAgentEvent(initialHermesState(), {
      type: 'clarify.request',
      id: 'c1',
      question: 'Which sessions should I delete?',
      choices: ['set A', 'set B'],
    });
    expect(s.pendingClarify).toMatchObject({ id: 'c1', question: 'Which sessions should I delete?', choices: ['set A', 'set B'] });
  });

  it('session.info sets currentModel and currentProvider', () => {
    let s = initialHermesState();
    expect(s.currentModel).toBeUndefined();
    s = applyAgentEvent(s, { type: 'session.info', model: 'claude-opus-5', provider: 'anthropic', cwd: '/tmp' });
    expect(s.currentModel).toBe('claude-opus-5');
    expect(s.currentProvider).toBe('anthropic');
  });

  it('session.title sets the title', () => {
    let s = initialHermesState();
    s = applyAgentEvent(s, { type: 'session.title', sessionId: 's1', title: 'Fix login test' });
    expect(s.title).toBe('Fix login test');
  });

  it('attachments are queued, drained, removed, and cleared', () => {
    let s = initialHermesState();
    expect(takeAttachments(s)).toEqual([]);
    s = addAttachment(s, 'a.png', '[User attached image: a.png]');
    s = addAttachment(s, 'docs/b.txt', '@file:docs/b.txt');
    expect(s.pendingAttachments).toHaveLength(2);
    expect(takeAttachments(s)).toEqual(['[User attached image: a.png]', '@file:docs/b.txt']);

    // takeAttachments does NOT clear (pure read).
    expect(s.pendingAttachments).toHaveLength(2);

    s = removeAttachment(s, 0);
    expect(s.pendingAttachments).toHaveLength(1);
    expect(s.pendingAttachments[0].label).toBe('docs/b.txt');

    // Out-of-range removal is a no-op (same reference).
    const before = s;
    expect(removeAttachment(s, 5)).toBe(before);

    s = clearAttachments(s);
    expect(s.pendingAttachments).toHaveLength(0);
  });

  it('deferred gateway.ready and unknown events are still no-ops', () => {
    let s = initialHermesState();
    s = pushUser(s, 'q');
    for (const ev of [
      { type: 'gateway.ready' } as AgentEvent,
      { type: 'unknown', eventType: 'whatever', payload: {} } as AgentEvent,
    ]) {
      const after = applyAgentEvent(s, ev);
      expect(after).toBe(s);
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

  it('stallTurn marks the streaming message errored and stops streaming', () => {
    let s = initialHermesState();
    s = pushUser(s, 'q');
    s = startTurn(s);
    const orig = s.messages[s.messages.length - 1];
    const out = stallTurn(s, '⚠️ No response from Hermes for 180s');

    const last = out.messages[out.messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.text).toBe('⚠️ No response from Hermes for 180s');
    expect(last.streaming).toBe(false);
    expect(last.complete).toBe(true);
    expect(out.streaming).toBe(false);
    expect(out.status).toBe('⚠️ No response from Hermes for 180s');
    // Immutable: the original streaming message is untouched.
    expect(orig.streaming).toBe(true);
    expect(orig.complete).toBe(false);
  });

  it('stallTurn with no streaming message only flips streaming/status', () => {
    const s = pushUser(initialHermesState(), 'q');
    const before = s.messages;
    const after = stallTurn(s, '⚠️ stalled');

    expect(after.messages).toBe(before);
    expect(after.streaming).toBe(false);
    expect(after.status).toBe('⚠️ stalled');
  });

  it('resyncMessages preserves sessionId/sessionKey/title and clears transient state', () => {
    const s = {
      ...initialHermesState(),
      sessionId: 'live1',
      sessionKey: 'stored1',
      title: 'My title',
      pendingApproval: { id: 'r1', command: 'x' },
      subagents: [{ id: 'sa1', depth: 0, goal: 'g' }],
      pendingThinking: 'buffer',
    };
    const out = resyncMessages(s, [{ role: 'user', text: 'hi' }]);
    expect(out.sessionId).toBe('live1');
    expect(out.sessionKey).toBe('stored1');
    expect(out.title).toBe('My title');
    expect(out.messages[0].text).toBe('hi');
    expect(out.pendingApproval).toBeUndefined();
    expect(out.subagents).toHaveLength(0);
    expect(out.pendingThinking).toBe('');
  });
});
