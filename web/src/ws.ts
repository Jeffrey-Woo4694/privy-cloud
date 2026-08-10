import type { ChatEntry } from '@privy/shared';
import { API_BASE } from './api';

export type ItemsEvent = { type: 'items:changed'; path: string; change: 'created' | 'modified' | 'deleted' | 'renamed' };
export interface WsCallbacks { onItemsChanged?: (e: ItemsEvent) => void; onChatNew?: (entry: ChatEntry) => void }

export function connect(callbacks: WsCallbacks): () => void {
  let ws: WebSocket | undefined;
  let closed = false;
  let retry = 500;
  const url = API_BASE.replace(/^http/, 'ws') + '/ws';

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 500; };
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data as string) as ItemsEvent | { type: 'chat:new'; entry: ChatEntry };
      if (data.type === 'items:changed') callbacks.onItemsChanged?.(data);
      if (data.type === 'chat:new') callbacks.onChatNew?.(data.entry);
    };
    ws.onclose = () => { if (closed) return; setTimeout(open, retry); retry = Math.min(retry * 2, 10_000); };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => { closed = true; ws?.close(); };
}
