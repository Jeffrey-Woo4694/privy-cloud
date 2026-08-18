import { describe, expect, it } from 'vitest';
import { encodeFrame, decodeFrame, encodeRequest } from '../../src/hermes/jsonrpc.js';

describe('jsonrpc', () => {
  it('encodes a request', () => {
    expect(encodeRequest(1, 'session.create', { cwd: '/tmp' }))
      .toBe('{"jsonrpc":"2.0","id":1,"method":"session.create","params":{"cwd":"/tmp"}}');
  });
  it('decodes a response', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","id":7,"result":{"session_id":"abc12345"}}'))
      .toEqual({ kind: 'response', id: 7, result: { session_id: 'abc12345' } });
  });
  it('decodes an error with null id', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"method not found"}}'))
      .toEqual({ kind: 'error', id: null, code: -32601, message: 'method not found' });
  });
  it('decodes an event with a session', () => {
    expect(decodeFrame('{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"abc12345","payload":{"text":"hel"}}}'))
      .toEqual({ kind: 'event', eventType: 'message.delta', sessionId: 'abc12345', payload: { text: 'hel' } });
  });
});
