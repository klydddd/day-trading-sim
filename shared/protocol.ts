import { z } from 'zod';
import type {
  AccountState, Candle, EndReason, Fill, Note, Order, OrderRequest, PriceEvent,
  SessionConfig, Trade, Warning,
} from './types';

export type MarketPhase = 'pre' | 'open' | 'closed';
export type DataStatus = 'connected' | 'reconnecting' | 'disconnected';
export type ReplaySpeed = 1 | 2 | 5 | 10;

export interface SessionStats {
  totalPnl: number; count: number; winRate: number; avgWin: number; avgLoss: number;
  biggestLoss: number; tradesFollowingRules: number; ruleBreaks: number;
}
export interface Review {
  sessionId: string; config: SessionConfig; replayDate: string | null; reason: EndReason;
  stats: SessionStats; trades: Trade[]; sessionPnl: number;
  overrides: { rule: 'daily_limit_override'; detail: string; ts: number }[];
  profitTarget?: { targetPct: number; hit: boolean; passed: boolean };
  observations?: string[];
}

export type ClientMessage =
  | { type: 'start_session'; config: SessionConfig }
  | { type: 'end_session' }
  | { type: 'preview_order'; req: OrderRequest }
  | { type: 'submit_order'; req: OrderRequest }
  | { type: 'cancel_order'; orderId: string }
  | { type: 'modify_order'; orderId: string; changes: { qty?: number; limitPrice?: number; stopPrice?: number } }
  | { type: 'close_position'; symbol: string }
  | { type: 'cancel_all' }
  | { type: 'replay_control'; action: 'play' | 'pause' | 'step' | 'speed'; speed?: ReplaySpeed }
  | { type: 'select_symbol'; symbol: string }
  | { type: 'set_watchlist'; symbols: string[] }
  | { type: 'override_daily_limit' }
  | { type: 'save_note'; tradeId: string; note: string }
  | { type: 'set_setting'; key: 'walkthroughDone'; value: boolean };

export type ServerMessage =
  | { type: 'status'; keysOk: boolean; market: { phase: MarketPhase; isOpen: boolean; nextOpen: number; nextClose: number }; data: DataStatus; settings?: ClientSettings }
  | { type: 'session'; id: string; config: SessionConfig; replayDate: string | null; status: 'active' | 'ended'; paused: boolean }
  | { type: 'account'; state: AccountState; equity: number; sessionPnl: number; buyingPower: number }
  | { type: 'price'; event: PriceEvent }
  | { type: 'candles'; symbol: string; candles: Candle[] }
  | { type: 'candle'; symbol: string; candle: Candle }
  | { type: 'order_update'; order: Order }
  | { type: 'fill'; fill: Fill }
  | { type: 'trade_closed'; trade: Trade }
  | { type: 'preview'; warnings: Warning[] }
  | { type: 'warning'; warning: Warning }
  | { type: 'note'; note: Note }
  | { type: 'daily_limit'; state: 'near' | 'paused' }
  | { type: 'clock'; simTs: number; speed: number; playing: boolean }
  | { type: 'session_ended'; reason: EndReason; review: Review }
  | { type: 'error'; message: string };

export interface ClientSettings {
  rules: import('./types').Rules; watchlist: string[]; feePerShare: number; walkthroughDone: boolean;
}

const pos = z.number().finite().positive();
const limit = z.object({ kind: z.enum(['dollars', 'percent']), value: z.number().finite().nonnegative() });
const rules = z.object({ maxLossPerTrade: limit, dailyLossLimit: limit, requireStop: z.boolean() });
const sessionConfig = z.object({
  dataSource: z.enum(['live', 'replay']),
  helpLevel: z.enum(['learn', 'challenge']),
  startingCash: pos,
  rules,
  replayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  replayStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  profitTargetPct: z.number().finite().positive().optional(),
  feePerShare: z.number().finite().nonnegative().optional(),
});
const orderRequest = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  side: z.enum(['buy', 'sell']),
  qty: z.number().finite(),
  type: z.enum(['market', 'limit', 'stop']),
  limitPrice: z.number().finite().optional(),
  stopPrice: z.number().finite().optional(),
  bracket: z.object({ stopLoss: z.number().finite().optional(), takeProfit: z.number().finite().optional() }).optional(),
  note: z.string().max(2000).optional(),
});
const symbol = z.string().min(1).max(10).transform((s) => s.toUpperCase());

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_session'), config: sessionConfig }),
  z.object({ type: z.literal('end_session') }),
  z.object({ type: z.literal('preview_order'), req: orderRequest }),
  z.object({ type: z.literal('submit_order'), req: orderRequest }),
  z.object({ type: z.literal('cancel_order'), orderId: z.string() }),
  z.object({
    type: z.literal('modify_order'), orderId: z.string(),
    changes: z.object({ qty: z.number().finite().optional(), limitPrice: z.number().finite().optional(), stopPrice: z.number().finite().optional() }),
  }),
  z.object({ type: z.literal('close_position'), symbol }),
  z.object({ type: z.literal('cancel_all') }),
  z.object({
    type: z.literal('replay_control'), action: z.enum(['play', 'pause', 'step', 'speed']),
    speed: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]).optional(),
  }),
  z.object({ type: z.literal('select_symbol'), symbol }),
  z.object({ type: z.literal('set_watchlist'), symbols: z.array(symbol) }),
  z.object({ type: z.literal('override_daily_limit') }),
  z.object({ type: z.literal('save_note'), tradeId: z.string(), note: z.string().max(2000) }),
  z.object({ type: z.literal('set_setting'), key: z.literal('walkthroughDone'), value: z.boolean() }),
]);

// Compile-time check that the schema's output matches ClientMessage.
type _Check = z.infer<typeof clientMessageSchema> extends ClientMessage ? true : never;
export const _schemaMatches: _Check = true;
