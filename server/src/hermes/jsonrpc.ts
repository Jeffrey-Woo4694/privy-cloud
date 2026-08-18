// JSON-RPC 2.0 frame codec for the Hermes Agent integration.
// Ported from the Rust reference implementation (`hermes_client::jsonrpc` in
// Native-Hermes). Decode order matches the Rust source exactly:
//   1. `method === "event"`   -> Event
//   2. `error` present        -> Error
//   3. `method` present       -> Request
//   4. else                   -> Response

export type JsonRpcFrame =
  | { kind: 'request'; id: number; method: string; params: unknown }
  | { kind: 'response'; id: number; result: unknown }
  | { kind: 'error'; id: number | null; code: number; message: string }
  | { kind: 'event'; eventType: string; sessionId: string | null; payload: unknown };

export function encodeFrame(f: JsonRpcFrame): string {
  switch (f.kind) {
    case 'request':
      return JSON.stringify({ jsonrpc: '2.0', id: f.id, method: f.method, params: f.params });
    case 'response':
      return JSON.stringify({ jsonrpc: '2.0', id: f.id, result: f.result });
    case 'error':
      return JSON.stringify({ jsonrpc: '2.0', id: f.id, error: { code: f.code, message: f.message } });
    case 'event': {
      const params: Record<string, unknown> = { type: f.eventType, payload: f.payload };
      if (f.sessionId !== null) params.session_id = f.sessionId;
      return JSON.stringify({ jsonrpc: '2.0', method: 'event', params });
    }
  }
}

export function decodeFrame(line: string): JsonRpcFrame {
  const v: unknown = JSON.parse(line);
  if (!isObject(v)) {
    throw new TypeError('JSON-RPC frame must be a JSON object');
  }
  const obj = v as Record<string, unknown>;

  if (obj.method === 'event') {
    const params = isObject(obj.params) ? obj.params : {};
    return {
      kind: 'event',
      eventType: typeof params.type === 'string' ? params.type : '',
      sessionId: typeof params.session_id === 'string' ? params.session_id : null,
      payload: 'payload' in params ? params.payload : null,
    };
  }

  if ('error' in obj) {
    const err = isObject(obj.error) ? obj.error : {};
    return {
      kind: 'error',
      id: typeof obj.id === 'number' ? obj.id : null,
      code: typeof err.code === 'number' ? err.code : -1,
      message: typeof err.message === 'string' ? err.message : '',
    };
  }

  if (typeof obj.method === 'string') {
    return {
      kind: 'request',
      id: typeof obj.id === 'number' ? obj.id : 0,
      method: obj.method,
      params: 'params' in obj ? obj.params : null,
    };
  }

  return {
    kind: 'response',
    id: typeof obj.id === 'number' ? obj.id : 0,
    result: 'result' in obj ? obj.result : null,
  };
}

export function encodeRequest(id: number, method: string, params: unknown): string {
  return encodeFrame({ kind: 'request', id, method, params });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
