import { create } from 'zustand';
import type { Candle, Fill, Note, Order, Print, Quote, Trade, Warning } from '../../shared/types';
import type { Review, ServerMessage } from '../../shared/protocol';

type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export interface AppState {
  connected: boolean;
  status?: Msg<'status'>;
  session?: Msg<'session'>;
  account?: Msg<'account'>;
  clock?: Msg<'clock'>;
  prices: Record<string, { quote?: Quote; print?: Print }>;
  candles: Record<string, Candle[]>;
  orders: Record<string, Order>;
  fills: Fill[];
  trades: Trade[];
  notes: Note[];
  warnings: Warning[];
  preview: Warning[];
  dailyLimit?: 'near' | 'paused';
  review?: Review;
  lastReject?: Order;
  lastError?: { message: string; at: number };
  selected?: string;
}

export const initialState = (): AppState => ({
  connected: false, prices: {}, candles: {}, orders: {}, fills: [], trades: [], notes: [], warnings: [], preview: [],
});

const sessionReset = (s: AppState): AppState => ({
  ...s, orders: {}, fills: [], trades: [], notes: [], warnings: [], preview: [], dailyLimit: undefined,
  review: undefined, lastReject: undefined, clock: undefined, account: undefined, prices: {}, candles: {},
});

/** Pure reducer: latest of each server message, plus accumulated orders/fills/trades/notes. */
export function reduce(s: AppState, m: ServerMessage): AppState {
  switch (m.type) {
    case 'status': return { ...s, status: m };
    case 'session': {
      const base = m.status === 'active' && s.session?.id !== m.id ? sessionReset(s) : s;
      return { ...base, session: m };
    }
    case 'account': {
      const orders: Record<string, Order> = {};
      for (const o of m.state.orders) orders[o.id] = o;
      return { ...s, account: m, orders };
    }
    case 'price': {
      const sym = m.event.kind === 'quote' ? m.event.quote.symbol : m.event.print.symbol;
      const cur = s.prices[sym] ?? {};
      const next = m.event.kind === 'quote' ? { ...cur, quote: m.event.quote } : { ...cur, print: m.event.print };
      return { ...s, prices: { ...s.prices, [sym]: next } };
    }
    case 'candles': return { ...s, candles: { ...s.candles, [m.symbol]: m.candles } };
    case 'candle': {
      const list = s.candles[m.symbol] ?? [];
      const last = list[list.length - 1];
      let next: Candle[];
      if (last && last.t === m.candle.t) next = [...list.slice(0, -1), m.candle];
      else if (!last || m.candle.t > last.t) next = [...list, m.candle];
      else next = list.map((c) => (c.t === m.candle.t ? m.candle : c));
      return { ...s, candles: { ...s.candles, [m.symbol]: next } };
    }
    case 'order_update': {
      const orders = { ...s.orders, [m.order.id]: m.order };
      return { ...s, orders, lastReject: m.order.status === 'rejected' ? m.order : s.lastReject };
    }
    case 'fill': return { ...s, fills: [...s.fills, m.fill] };
    case 'trade_closed': return { ...s, trades: [...s.trades.filter((t) => t.id !== m.trade.id), m.trade] };
    case 'preview': return { ...s, preview: m.warnings };
    case 'warning': return { ...s, warnings: [...s.warnings, m.warning].slice(-6) };
    case 'note': return { ...s, notes: [...s.notes, m.note] };
    case 'daily_limit': return { ...s, dailyLimit: m.state };
    case 'clock': return { ...s, clock: m };
    case 'session_ended': return { ...s, review: m.review, trades: m.review.trades };
    case 'error': return { ...s, lastError: { message: m.message, at: Date.now() } };
  }
}

interface Actions {
  apply(m: ServerMessage): void;
  setConnected(c: boolean): void;
  select(symbol: string): void;
  dismissNote(ts: number): void;
  clearReview(): void;
  clearReject(): void;
  clearError(): void;
  clearDailyLimit(): void;
  setWalkthroughDone(): void;
}

export const useStore = create<AppState & Actions>((set) => ({
  ...initialState(),
  apply: (m) => set((s) => reduce(s, m)),
  setConnected: (connected) => set({ connected }),
  select: (selected) => set({ selected }),
  dismissNote: (ts) => set((s) => ({ notes: s.notes.filter((n) => n.ts !== ts) })),
  clearReview: () => set((s) => ({ ...sessionReset(s), session: undefined })),
  clearReject: () => set({ lastReject: undefined }),
  clearError: () => set({ lastError: undefined }),
  clearDailyLimit: () => set({ dailyLimit: undefined }),
  setWalkthroughDone: () => set((s) => (s.status?.settings
    ? { status: { ...s.status, settings: { ...s.status.settings, walkthroughDone: true } } } : {})),
}));

export const workingOrders = (orders: Record<string, Order>) =>
  Object.values(orders).filter((o) => o.status === 'working' || o.status === 'pending_parent');
