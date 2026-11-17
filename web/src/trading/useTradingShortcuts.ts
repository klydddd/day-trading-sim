import { useEffect, useRef } from 'react';
import type { ClientMessage } from '../../../shared/protocol';
import type { Side } from '../../../shared/types';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** B: ticket on Buy · S: ticket on Sell · C: close selected position · Shift+X: cancel all orders. */
export function useTradingShortcuts(opts: { send: (m: ClientMessage) => void; symbol: string; onFocusSide: (s: Side) => void }) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const { send, symbol, onFocusSide } = ref.current;
      if (e.shiftKey && k === 'x') { e.preventDefault(); send({ type: 'cancel_all' }); return; }
      if (e.shiftKey) return;
      if (k === 'b') { e.preventDefault(); onFocusSide('buy'); }
      else if (k === 's') { e.preventDefault(); onFocusSide('sell'); }
      else if (k === 'c') { e.preventDefault(); send({ type: 'close_position', symbol }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
