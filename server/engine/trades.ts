import { randomUUID } from 'node:crypto';
import { roundCents } from '../../shared/money';
import type { Fill, Order, RuleBreak, Trade } from '../../shared/types';

interface TrackerSnapshot {
  sessionId: string;
  open: Record<string, Trade>;
  closed: Trade[];
  pendingBreaks: Record<string, RuleBreak[]>;
}

/** Groups fills into round trips: flat -> long -> flat. */
export class TradeTracker {
  private openTrades: Record<string, Trade> = {};
  private closedTrades: Trade[] = [];
  private pendingBreaks: Record<string, RuleBreak[]> = {};

  constructor(private readonly sessionId: string, private readonly idGen: () => string = randomUUID) {}

  onFill(fill: Fill, order: Order, positionQtyAfter: number): { opened?: Trade; closed?: Trade } {
    const sym = fill.symbol;
    let trade = this.openTrades[sym];
    const result: { opened?: Trade; closed?: Trade } = {};
    if (!trade) {
      if (fill.side !== 'buy') return result; // a sell with no open trade cannot happen long-only
      trade = {
        id: this.idGen(), sessionId: this.sessionId, symbol: sym, openedAt: fill.ts, maxQty: 0,
        avgEntry: 0, pnl: 0, fees: 0, ruleBreaks: this.pendingBreaks[sym] ?? [], fills: [],
      };
      if (order.note) trade.note = order.note;
      delete this.pendingBreaks[sym];
      this.openTrades[sym] = trade;
      result.opened = trade;
    }
    trade.fills.push({ ...fill });
    trade.fees = roundCents(trade.fees + fill.fee);
    trade.maxQty = Math.max(trade.maxQty, positionQtyAfter);
    const buys = trade.fills.filter((f) => f.side === 'buy');
    const sells = trade.fills.filter((f) => f.side === 'sell');
    trade.avgEntry = avg(buys);
    if (sells.length) trade.avgExit = avg(sells);
    trade.pnl = roundCents(value(sells) - value(buys) - trade.fees);

    if (positionQtyAfter === 0) {
      trade.closedAt = fill.ts;
      delete this.openTrades[sym];
      this.closedTrades.push(trade);
      result.closed = trade;
    }
    if (result.opened) result.opened = structuredClone(result.opened);
    if (result.closed) result.closed = structuredClone(result.closed);
    return result;
  }

  attachBreaks(symbol: string, breaks: RuleBreak[]): void {
    if (!breaks.length) return;
    const t = this.openTrades[symbol];
    if (t) t.ruleBreaks.push(...breaks);
    else (this.pendingBreaks[symbol] ??= []).push(...breaks);
  }

  noteStop(symbol: string, stop: number): void {
    const t = this.openTrades[symbol];
    if (t && t.stopUsed === undefined) t.stopUsed = stop;
  }

  noteTarget(symbol: string, target: number): void {
    const t = this.openTrades[symbol];
    if (t && t.targetUsed === undefined) t.targetUsed = target;
  }

  /** Update the note on a closed or open trade. Returns the updated trade. */
  setNote(tradeId: string, note: string): Trade | undefined {
    const t = [...Object.values(this.openTrades), ...this.closedTrades].find((x) => x.id === tradeId);
    if (t) t.note = note;
    return t ? structuredClone(t) : undefined;
  }

  open(): Trade[] { return structuredClone(Object.values(this.openTrades)); }
  closed(): Trade[] { return structuredClone(this.closedTrades); }

  snapshot(): unknown {
    const s: TrackerSnapshot = { sessionId: this.sessionId, open: this.openTrades, closed: this.closedTrades, pendingBreaks: this.pendingBreaks };
    return structuredClone(s);
  }

  static restore(s: unknown, idGen?: () => string): TradeTracker {
    const snap = s as TrackerSnapshot;
    const t = new TradeTracker(snap.sessionId, idGen);
    t.openTrades = structuredClone(snap.open);
    t.closedTrades = structuredClone(snap.closed);
    t.pendingBreaks = structuredClone(snap.pendingBreaks);
    return t;
  }
}

const value = (fs: Fill[]) => fs.reduce((a, f) => a + f.qty * f.price, 0);
const avg = (fs: Fill[]) => {
  const q = fs.reduce((a, f) => a + f.qty, 0);
  return q ? roundCents(value(fs) / q) : 0;
};
