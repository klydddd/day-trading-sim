import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { useStore } from './store';

let ws: WebSocket | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Connect to the local server; reconnects every 2 s while disconnected. */
export function connect(): void {
  clearTimeout(timer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => useStore.getState().setConnected(true);
  sock.onmessage = (e) => {
    try { useStore.getState().apply(JSON.parse(e.data) as ServerMessage); } catch { /* ignore malformed */ }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    useStore.getState().setConnected(false);
    timer = setTimeout(connect, 2000);
  };
}

export function send(m: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else useStore.getState().apply({ type: 'error', message: 'Not connected to the local server. Is `npm run dev` running?' });
}
