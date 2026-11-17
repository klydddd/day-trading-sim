export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type HelpLevel = 'learn' | 'challenge';
export type DataSource = 'live' | 'replay';

export interface Quote { symbol: string; bid: number; ask: number; ts: number }
export interface Print { symbol: string; price: number; size: number; ts: number } // a market trade print
export type PriceEvent = { kind: 'quote'; quote: Quote } | { kind: 'print'; print: Print };
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number } // t = minute start
export type Candle = Bar;

export interface OrderRequest {
  symbol: string; side: Side; qty: number; type: OrderType;
  limitPrice?: number; stopPrice?: number;
  bracket?: { stopLoss?: number; takeProfit?: number };
  note?: string;
}
export type OrderStatus = 'pending_parent' | 'working' | 'filled' | 'cancelled' | 'rejected';
export interface Order extends OrderRequest {
  id: string; status: OrderStatus; createdAt: number;
  parentId?: string; ocoGroup?: string; triggered?: boolean;
  filledAt?: number; fillPrice?: number; rejectReason?: RejectReason;
}
export type RejectReason = 'no_quote' | 'stale_data' | 'insufficient_cash' | 'no_position'
  | 'invalid_qty' | 'invalid_price' | 'unsupported' | 'daily_limit' | 'session_ended';
export interface Fill { orderId: string; symbol: string; side: Side; qty: number; price: number; fee: number; ts: number; slippage?: number }
export interface Position { symbol: string; qty: number; avgPrice: number }
export interface AccountState { cash: number; positions: Record<string, Position>; orders: Order[]; realizedPnl: number }

export type RuleCode = 'no_stop' | 'risk_over_limit' | 'daily_limit_hit' | 'daily_limit_override';
export interface RuleBreak { rule: RuleCode; detail: string; ts: number }
export type WarningCode = 'no_stop' | 'risk_over_limit' | 'near_daily_limit' | 'chasing' | 'wide_spread';
export interface Warning { code: WarningCode; message: string }
export type NoteCode = 'stop_slippage' | 'limit_touched_no_fill' | 'iex_volume' | 'modeled_spread';
export interface Note { code: NoteCode; message: string; ts: number }

export interface Trade {           // one round trip: flat -> long -> flat
  id: string; sessionId: string; symbol: string;
  openedAt: number; closedAt?: number; maxQty: number;
  avgEntry: number; avgExit?: number; pnl: number; fees: number;
  stopUsed?: number; targetUsed?: number; note?: string;
  ruleBreaks: RuleBreak[]; fills: Fill[];
}
export interface Limit { kind: 'dollars' | 'percent'; value: number }
export interface Rules { maxLossPerTrade: Limit; dailyLossLimit: Limit; requireStop: boolean }
export interface SessionConfig {
  dataSource: DataSource; helpLevel: HelpLevel; startingCash: number; rules: Rules;
  replayDate?: string;     // 'YYYY-MM-DD'; ignored (random) in challenge+replay
  replayStartTime?: string; // 'HH:mm' ET, default '09:30'
  profitTargetPct?: number; // challenge only
  feePerShare?: number;
}
export type EndReason = 'user' | 'daily_limit' | 'market_close';

export const DEFAULT_RULES: Rules = {
  maxLossPerTrade: { kind: 'percent', value: 1 },
  dailyLossLimit: { kind: 'percent', value: 3 },
  requireStop: true,
};
export const DEFAULT_STARTING_CASH = 25_000;
export const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD'];
export const MAX_WATCHLIST = 30;
