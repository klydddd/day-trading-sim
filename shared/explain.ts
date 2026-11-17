import { fmtPct, fmtUsd } from './money';
import type { OrderRequest, Quote } from './types';

const shares = (n: number) => `${n} ${n === 1 ? 'share' : 'shares'}`;

/** Plain-English, in-dollars description of what an order means (Learn mode pre-trade explanation). */
export function explainOrder(req: OrderRequest, quote: Quote, startingCash: number): string {
  const sym = req.symbol.toUpperCase();
  if (req.side === 'sell') {
    if (req.type === 'stop' && req.stopPrice) {
      return `If ${sym} trades at or below ${fmtUsd(req.stopPrice)}, this sells ${shares(req.qty)} at the next available price, which can be lower than your stop.`;
    }
    const px = req.type === 'limit' && req.limitPrice ? req.limitPrice : quote.bid;
    const tail = req.type === 'limit' && req.limitPrice && req.limitPrice > quote.bid
      ? ` It only fills if the price trades above ${fmtUsd(req.limitPrice)}.` : '';
    return `Selling ${shares(req.qty)} of ${sym} at ~${fmtUsd(px)} = ${fmtUsd(px * req.qty, 0)}.${tail}`;
  }
  const px = req.type === 'limit' && req.limitPrice ? req.limitPrice : quote.ask;
  const parts = [`Buying ${shares(req.qty)} of ${sym} at ~${fmtUsd(px)} = ${fmtUsd(px * req.qty, 0)}.`];
  const stop = req.bracket?.stopLoss;
  const target = req.bracket?.takeProfit;
  if (stop !== undefined) {
    const risk = (px - stop) * req.qty;
    parts.push(`Your stop at ${fmtUsd(stop)} risks ${fmtUsd(risk, 0)} (${fmtPct(risk / startingCash)} of your account).`);
  } else {
    parts.push("You have no stop-loss, so your possible loss isn't limited.");
  }
  if (target !== undefined) {
    parts.push(`Your target at ${fmtUsd(target)} would make ${fmtUsd((target - px) * req.qty, 0)}.`);
  }
  return parts.join(' ');
}
