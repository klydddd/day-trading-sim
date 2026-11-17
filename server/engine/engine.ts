import { fmtUsd, roundCents } from '../../shared/money';
import type {
  AccountState, Fill, Note, Order, OrderRequest, PriceEvent, Print, Quote, RejectReason,
} from '../../shared/types';

export type EngineEvent =
  | { kind: 'order_update'; order: Order }
  | { kind: 'fill'; fill: Fill }
  | { kind: 'note'; note: Note };
export interface EngineSnapshot { state: AccountState; lastQuotes: Record<string, Quote>; seq: number; touched?: string[] }

const isLive = (o: Order) => o.status === 'working' || o.status === 'pending_parent';
const clone = <T>(v: T): T => structuredClone(v);

/**
 * The simulation engine. Pure: no I/O, no clocks. Fed by PriceEvents.
 * Fill rules are realistic-to-pessimistic, never optimistic (PRD §5.3).
 */
export class Engine {
  private cash: number;
  private positions: Record<string, { symbol: string; qty: number; avgPrice: number }> = {};
  private orders: Order[] = [];
  private realizedPnl = 0;
  private quotes: Record<string, Quote> = {};
  private seq = 0;
  private touched = new Set<string>(); // orders that already got a limit_touched_no_fill note
  private readonly feePerShare: number;
  private readonly idGen: () => string;

  constructor(opts: { startingCash: number; feePerShare: number; idGen?: () => string }) {
    this.cash = roundCents(opts.startingCash);
    this.feePerShare = opts.feePerShare;
    this.idGen = opts.idGen ?? (() => `o${++this.seq}`);
  }

  // ---------- public API ----------

  submit(req: OrderRequest, now: number): EngineEvent[] {
    const order: Order = {
      ...clone(req), symbol: req.symbol.toUpperCase(), id: this.idGen(), status: 'working', createdAt: now,
    };
    this.orders.push(order);
    const reason = this.validate(order);
    if (reason) return [this.reject(order, reason)];

    const events: EngineEvent[] = [this.update(order)];
    if (order.side === 'buy' && order.bracket) events.push(...this.createChildren(order, now));
    if (order.type === 'stop') {
      const quote = this.quotes[order.symbol];
      if (quote && quote.bid <= (order.stopPrice as number)) order.triggered = true; // already through: fills on next quote
    }
    events.push(...this.tryImmediate(order, now));
    return events;
  }

  cancel(orderId: string, now: number): EngineEvent[] {
    const o = this.orders.find((x) => x.id === orderId);
    if (!o || !isLive(o)) return [];
    return this.cancelOrder(o, now);
  }

  modify(orderId: string, changes: { qty?: number; limitPrice?: number; stopPrice?: number }, now: number): EngineEvent[] {
    const o = this.orders.find((x) => x.id === orderId);
    if (!o || !isLive(o)) return [];
    const next: Order = { ...o, ...stripUndefined(changes) };
    const reason = this.validate(next);
    if (reason) return [];
    Object.assign(o, stripUndefined(changes));
    this.touched.delete(o.id);
    const events: EngineEvent[] = [this.update(o)];
    if (o.status === 'working') events.push(...this.tryImmediate(o, now));
    return events;
  }

  closePosition(symbol: string, now: number): EngineEvent[] {
    const sym = symbol.toUpperCase();
    const events: EngineEvent[] = [];
    for (const o of this.orders) {
      if (o.symbol === sym && o.side === 'sell' && isLive(o)) events.push(...this.cancelOrder(o, now));
    }
    const pos = this.positions[sym];
    if (!pos) return events;
    return [...this.submit({ symbol: sym, side: 'sell', qty: pos.qty, type: 'market' }, now), ...events];
  }

  cancelAll(now: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const o of this.orders) if (isLive(o)) events.push(...this.cancelOrder(o, now));
    return events;
  }

  onPrice(ev: PriceEvent): EngineEvent[] {
    if (ev.kind === 'quote') {
      this.quotes[ev.quote.symbol] = { ...ev.quote };
      return this.onQuote(ev.quote);
    }
    return this.onPrint(ev.print);
  }

  state(): AccountState {
    return clone({ cash: this.cash, positions: this.positions, orders: this.orders, realizedPnl: this.realizedPnl });
  }

  lastQuote(symbol: string): Quote | undefined {
    const q = this.quotes[symbol.toUpperCase()];
    return q ? { ...q } : undefined;
  }

  equity(): number {
    let eq = this.cash;
    for (const p of Object.values(this.positions)) eq += p.qty * (this.quotes[p.symbol]?.bid ?? p.avgPrice);
    return roundCents(eq);
  }

  buyingPower(exclude?: string): number {
    let reserved = 0;
    for (const o of this.orders) {
      if (o.id !== exclude && o.status === 'working' && o.side === 'buy' && o.type === 'limit') {
        reserved += o.qty * (o.limitPrice ?? 0) + this.fee(o.qty);
      }
    }
    return roundCents(this.cash - reserved);
  }

  snapshot(): EngineSnapshot {
    return clone({ state: this.state(), lastQuotes: this.quotes, seq: this.seq, touched: [...this.touched] });
  }

  static restore(s: EngineSnapshot, opts: { feePerShare: number; idGen?: () => string }): Engine {
    const e = new Engine({ startingCash: s.state.cash, feePerShare: opts.feePerShare, idGen: opts.idGen });
    e.cash = s.state.cash;
    e.positions = clone(s.state.positions);
    e.orders = clone(s.state.orders);
    e.realizedPnl = s.state.realizedPnl;
    e.quotes = clone(s.lastQuotes);
    e.seq = s.seq;
    e.touched = new Set(s.touched ?? []);
    return e;
  }

  // ---------- internals ----------

  private fee(qty: number) { return roundCents(this.feePerShare * qty); }

  private validate(o: Order): RejectReason | undefined {
    if (!Number.isInteger(o.qty) || o.qty <= 0) return 'invalid_qty';
    if (o.type === 'limit' && !(Number(o.limitPrice) > 0)) return 'invalid_price';
    if (o.type === 'stop') {
      if (o.side === 'buy') return 'unsupported';
      if (!(Number(o.stopPrice) > 0)) return 'invalid_price';
    }
    const quote = this.quotes[o.symbol];
    if (o.side === 'sell') {
      // Bracket children may exist before the parent fills; they are checked when activated.
      if (!o.parentId && !(this.positions[o.symbol]?.qty > 0)) return 'no_position';
      if (o.type === 'market' && !quote) return 'no_quote';
      return undefined;
    }
    if (o.type === 'market' && !quote) return 'no_quote';
    const ref = o.type === 'market' ? quote!.ask : (o.limitPrice as number);
    const b = o.bracket;
    if (b) {
      if (b.stopLoss !== undefined && !(b.stopLoss > 0 && b.stopLoss < ref)) return 'invalid_price';
      if (b.takeProfit !== undefined && !(b.takeProfit > ref)) return 'invalid_price';
    }
    if (o.qty * ref + this.fee(o.qty) > this.buyingPower(o.id) + 1e-9) return 'insufficient_cash';
    return undefined;
  }

  private reject(o: Order, reason: RejectReason): EngineEvent {
    o.status = 'rejected';
    o.rejectReason = reason;
    return this.update(o);
  }

  private update(o: Order): EngineEvent {
    return { kind: 'order_update', order: clone(o) };
  }

  private cancelOrder(o: Order, now: number): EngineEvent[] {
    o.status = 'cancelled';
    const events = [this.update(o)];
    for (const child of this.orders) {
      if (child.parentId === o.id && child.status === 'pending_parent') events.push(...this.cancelOrder(child, now));
    }
    return events;
  }

  /** Bracket: a stop-loss and a take-profit sell, one-cancels-other, activated when the parent fills. */
  private createChildren(parent: Order, now: number): EngineEvent[] {
    const b = parent.bracket!;
    const ocoGroup = `oco-${parent.id}`;
    const base = { symbol: parent.symbol, side: 'sell' as const, qty: parent.qty, status: 'pending_parent' as const, createdAt: now, parentId: parent.id, ocoGroup };
    const kids: Order[] = [];
    if (b.stopLoss !== undefined) kids.push({ ...base, id: this.idGen(), type: 'stop', stopPrice: b.stopLoss });
    if (b.takeProfit !== undefined) kids.push({ ...base, id: this.idGen(), type: 'limit', limitPrice: b.takeProfit });
    this.orders.push(...kids);
    return kids.map((k) => this.update(k));
  }

  /** Fill at once if the order is market or marketable against the current quote. */
  private tryImmediate(o: Order, now: number): EngineEvent[] {
    const quote = this.quotes[o.symbol];
    if (!quote || o.status !== 'working') return [];
    if (o.type === 'market') return this.fill(o, o.side === 'buy' ? quote.ask : quote.bid, now);
    if (o.type === 'limit') {
      if (o.side === 'buy' && (o.limitPrice as number) >= quote.ask) return this.fill(o, quote.ask, now);
      if (o.side === 'sell' && (o.limitPrice as number) <= quote.bid) return this.fill(o, quote.bid, now);
    }
    return [];
  }

  /** Triggered stops fill on the next quote, at its bid (never at the stop price itself). */
  private onQuote(quote: Quote): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const o of [...this.orders]) {
      if (o.symbol !== quote.symbol || o.status !== 'working' || o.type !== 'stop' || !o.triggered) continue;
      const stop = o.stopPrice as number;
      const slippage = Math.max(0, roundCents(stop - quote.bid));
      const filled = this.fill(o, quote.bid, quote.ts, { slippage });
      events.push(...filled);
      if (slippage > 0 && filled.some((e) => e.kind === 'fill')) {
        events.push({ kind: 'note', note: { code: 'stop_slippage', ts: quote.ts, message:
          `Your stop at ${fmtUsd(stop)} filled at ${fmtUsd(roundCents(quote.bid))} (${fmtUsd(slippage)} worse) because the price jumped past it. Stops limit losses but don't guarantee your price.` } });
      }
    }
    return events;
  }

  private onPrint(pr: Print): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const o of [...this.orders]) {
      if (o.symbol !== pr.symbol || o.status !== 'working') continue;
      if (o.type === 'stop') {
        if (!o.triggered && pr.price <= (o.stopPrice as number)) {
          o.triggered = true;
          events.push(this.update(o));
        }
        continue;
      }
      if (o.type !== 'limit') continue;
      const lim = o.limitPrice as number;
      const through = o.side === 'buy' ? pr.price < lim : pr.price > lim;
      if (through) {
        events.push(...this.fill(o, lim, pr.ts));
      } else if (pr.price === lim && !this.touched.has(o.id)) {
        this.touched.add(o.id);
        events.push({ kind: 'note', note: { code: 'limit_touched_no_fill', ts: pr.ts, message: touchedMessage(o) } });
      }
    }
    return events;
  }

  private fill(o: Order, rawPrice: number, ts: number, extra: { slippage?: number } = {}): EngineEvent[] {
    const price = roundCents(rawPrice);
    const sym = o.symbol;
    const events: EngineEvent[] = [];
    let qty = o.qty;
    if (o.side === 'sell') {
      const pos = this.positions[sym];
      if (!pos || pos.qty <= 0) return this.cancelOrder(o, ts);
      qty = Math.min(o.qty, pos.qty);
    }
    const fee = this.fee(qty);
    if (o.side === 'buy') {
      const cost = roundCents(qty * price + fee);
      if (cost > this.cash + 1e-9) return this.cancelOrder(o, ts);
      this.cash = roundCents(this.cash - cost);
      const pos = this.positions[sym] ?? { symbol: sym, qty: 0, avgPrice: 0 };
      const newQty = pos.qty + qty;
      pos.avgPrice = (pos.qty * pos.avgPrice + qty * price) / newQty; // exact weighted average
      pos.qty = newQty;
      this.positions[sym] = pos;
    } else {
      const pos = this.positions[sym];
      this.cash = roundCents(this.cash + qty * price - fee);
      this.realizedPnl = roundCents(this.realizedPnl + (price - pos.avgPrice) * qty - fee);
      pos.qty -= qty;
    }
    o.status = 'filled';
    o.filledAt = ts;
    o.fillPrice = price;
    if (o.side === 'sell' && qty !== o.qty) o.qty = qty;
    events.push(this.update(o));
    const fill: Fill = { orderId: o.id, symbol: sym, side: o.side, qty, price, fee, ts };
    if (extra.slippage !== undefined) fill.slippage = extra.slippage;
    events.push({ kind: 'fill', fill });

    if (o.side === 'buy') {
      for (const child of this.orders) {
        if (child.parentId === o.id && child.status === 'pending_parent') {
          child.status = 'working';
          events.push(this.update(child));
        }
      }
    }
    if (o.ocoGroup) {
      for (const sib of this.orders) {
        if (sib !== o && sib.ocoGroup === o.ocoGroup && isLive(sib)) events.push(...this.cancelOrder(sib, ts));
      }
    }

    if (o.side === 'sell' && this.positions[sym].qty === 0) {
      delete this.positions[sym];
      for (const other of this.orders) {
        if (other.symbol === sym && other.side === 'sell' && other.status === 'working') {
          events.push(...this.cancelOrder(other, ts));
        }
      }
    }
    return events;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function touchedMessage(o: Order): string {
  const lim = fmtUsd(o.limitPrice as number);
  return `Your limit ${o.side} at ${lim} didn't fill even though the price touched ${lim}. `
    + `In a real market other orders at that price are usually ahead of yours, so this simulator only fills a limit order when the price trades through it.`;
}
