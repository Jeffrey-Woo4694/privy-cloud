import { describe, expect, it } from 'vitest';
import { parseAgentEvent } from '../../src/hermes/events.js';

describe('events', () => {
  it('parses gateway tool.complete (tool_id/duration_s/summary, no ok = success)', () => {
    expect(parseAgentEvent('tool.complete', { tool_id: 'call_123', name: 'read_file', duration_s: 0.05, summary: 'read 931 chars' }))
      .toEqual({ type: 'tool.complete', id: 'call_123', name: 'read_file', ok: true, duration: 0.05, resultPreview: 'read 931 chars' });
  });
  it('parses gateway tool.start (tool_id/context)', () => {
    expect(parseAgentEvent('tool.start', { tool_id: 'call_123', name: 'read_file', context: 'read_file(path=x)' }))
      .toEqual({ type: 'tool.start', id: 'call_123', name: 'read_file', preview: 'read_file(path=x)' });
  });
  it('parses subagent.start (subagent_id/parent_id/depth)', () => {
    expect(parseAgentEvent('subagent.start', { subagent_id: 'sa1', parent_id: 'root', depth: 1, goal: 'g', model: 'm' }))
      .toEqual({ type: 'subagent.start', id: 'sa1', parentId: 'root', depth: 1, goal: 'g', model: 'm' });
  });
  it('preserves unknown events', () => {
    expect(parseAgentEvent('surprise.event', { x: 1 })).toEqual({ type: 'unknown', eventType: 'surprise.event', payload: { x: 1 } });
  });
  it('defaults missing fields safely', () => {
    expect(parseAgentEvent('message.complete', {})).toEqual({ type: 'message.complete', text: '', status: 'ok' });
  });

  // ---- Additional coverage, ported from the Rust events.rs test module ----

  it('parses tool.complete via native id/duration/result_preview fields', () => {
    expect(parseAgentEvent('tool.complete', { id: 't1', name: 'shell', ok: true, duration: 1.2, result_preview: 'ok' }))
      .toEqual({ type: 'tool.complete', id: 't1', name: 'shell', ok: true, duration: 1.2, resultPreview: 'ok' });
  });

  it('parses session.title', () => {
    expect(parseAgentEvent('session.title', { session_id: 'abc123', title: 'Fix the layout bug' }))
      .toEqual({ type: 'session.title', sessionId: 'abc123', title: 'Fix the layout bug' });
  });

  it('parses session.info', () => {
    expect(parseAgentEvent('session.info', { model: 'gpt-5', provider: 'openai', cwd: '/tmp' }))
      .toEqual({ type: 'session.info', model: 'gpt-5', provider: 'openai', cwd: '/tmp' });
  });

  it('parses clarify.request', () => {
    expect(parseAgentEvent('clarify.request', {
      request_id: 'abc123',
      question: 'Which sessions should I delete?',
      choices: ['set A', 'set B'],
    })).toEqual({ type: 'clarify.request', id: 'abc123', question: 'Which sessions should I delete?', choices: ['set A', 'set B'] });
  });

  it('parses approval.request', () => {
    expect(parseAgentEvent('approval.request', { id: 'r1', command: 'cargo test', tool: 'shell' }))
      .toEqual({ type: 'approval.request', id: 'r1', command: 'cargo test', tool: 'shell', payload: { id: 'r1', command: 'cargo test', tool: 'shell' } });
  });

  it('parses thinking.delta', () => {
    expect(parseAgentEvent('thinking.delta', { text: 'let me think' })).toEqual({ type: 'thinking.delta', text: 'let me think' });
  });

  it('parses reasoning.delta', () => {
    expect(parseAgentEvent('reasoning.delta', { text: 'step 1' })).toEqual({ type: 'reasoning.delta', text: 'step 1' });
  });

  it('parses reasoning.available', () => {
    expect(parseAgentEvent('reasoning.available', { text: 'full reasoning' })).toEqual({ type: 'reasoning.available', text: 'full reasoning' });
  });

  it('parses subagent.complete', () => {
    expect(parseAgentEvent('subagent.complete', { subagent_id: 'sa1', status: 'ok' }))
      .toEqual({ type: 'subagent.complete', id: 'sa1', status: 'ok' });
  });

  it('parses the remaining simple variants', () => {
    expect(parseAgentEvent('gateway.ready', {})).toEqual({ type: 'gateway.ready' });
    expect(parseAgentEvent('message.start', {})).toEqual({ type: 'message.start' });
    expect(parseAgentEvent('message.delta', { text: 'hel' })).toEqual({ type: 'message.delta', text: 'hel' });
    expect(parseAgentEvent('tool.generating', { name: 'read_file' })).toEqual({ type: 'tool.generating', name: 'read_file' });
    expect(parseAgentEvent('status.update', { kind: 'info', text: 'connecting' })).toEqual({ type: 'status.update', kind: 'info', text: 'connecting' });
    expect(parseAgentEvent('error', { message: 'boom' })).toEqual({ type: 'error', message: 'boom' });
  });

  it('defaults error.message to unknown error', () => {
    expect(parseAgentEvent('error', {})).toEqual({ type: 'error', message: 'unknown error' });
  });

  it('defaults subagent.start depth to 0 and goal to empty', () => {
    expect(parseAgentEvent('subagent.start', { subagent_id: 'sa2' }))
      .toEqual({ type: 'subagent.start', id: 'sa2', depth: 0, goal: '' });
  });
});
