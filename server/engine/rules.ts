import { fmtPct, fmtUsd, roundCents } from '../../shared/money';
import type { Limit, OrderRequest, Print, Quote, RuleBreak, Rules, Warning } from '../../shared/types';

export function limitToDollars(l: Limit, startingCash: number): number {
  return l.kind === 'percent' ? roundCents((startingCash * l.value) / 100) : l.value;
}

export function dailyLimitState(sessionPnl: number, rules: Rules, startingCash: number): 'ok' | 'near' | 'hit' {
  const limit = limitToDollars(rules.dailyLossLimit, startingCash);
  if (limit <= 0) return 'ok';
  const loss = -sessionPnl;
  if (loss >= limit - 1e-9) return 'hit';
  if (loss >= 0.8 * limit - 1e-9) return 'near';
  return 'ok';
}

const CHASE_WINDOW_MS = 2 * 60_000;
const CHASE_PCT = 0.01;
const WIDE_SPREAD = 0.001;

/**
 * Checks a new entry (buy) against the user's rules. Returns plain-English warnings
 * (shown only in Learn) and rule breaks (always recorded). Never advises buying or selling.
 */
export function evaluateEntry(req: OrderRequest, ctx: {
  quote: Quote; rules: Rules; startingCash: number; sessionPnl: number; recentPrints: Print[]; now: number;
}): { warnings: Warning[]; breaks: RuleBreak[] } {
  const warnings: Warning[] = [];
  const breaks: RuleBreak[] = [];
  if (req.side !== 'buy') return { warnings, breaks };
  const { quote, rules, startingCash, now } = ctx;
  const entryRef = req.type === 'limit' && req.limitPrice ? req.limitPrice : quote.ask;
  const stop = req.bracket?.stopLoss;

  if (stop === undefined) {
    const message = "This order has no stop-loss, so your possible loss isn't limited.";
    warnings.push({ code: 'no_stop', message });
    if (rules.requireStop) breaks.push({ rule: 'no_stop', detail: `${req.symbol}: entered without a stop-loss.`, ts: now });
  } else {
    const risk = roundCents((entryRef - stop) * req.qty);
    const maxRisk = limitToDollars(rules.maxLossPerTrade, startingCash);
    if (risk > maxRisk + 1e-9) {
      const message = `If your stop is hit you could lose ${fmtUsd(risk, 0)} (${fmtPct(risk / startingCash)} of your account). Your rule is at most ${fmtUsd(maxRisk, 0)} per trade.`;
      warnings.push({ code: 'risk_over_limit', message });
      breaks.push({ rule: 'risk_over_limit', detail: `${req.symbol}: risked ${fmtUsd(risk)} vs a ${fmtUsd(maxRisk)} limit.`, ts: now });
    }
  }

  if (dailyLimitState(ctx.sessionPnl, rules, startingCash) === 'near') {
    const limit = limitToDollars(rules.dailyLossLimit, startingCash);
    const lost = -ctx.sessionPnl;
    warnings.push({
      code: 'near_daily_limit',
      message: `You're down ${fmtUsd(lost, 0)} today. Your daily loss limit is ${fmtUsd(limit, 0)}, so ${fmtUsd(Math.max(0, limit - lost), 0)} more in losses pauses trading for the day.`,
    });
  }

  const window = ctx.recentPrints.filter((p) => p.symbol === req.symbol && p.ts >= now - CHASE_WINDOW_MS && p.ts <= now);
  if (window.length >= 2) {
    const low = Math.min(...window.map((p) => p.price));
    const last = window[window.length - 1].price;
    const rise = (last - low) / low;
    if (rise >= CHASE_PCT) {
      warnings.push({
        code: 'chasing',
        message: `${req.symbol} has risen ${fmtPct(rise)} in the last 2 minutes. Entering right after a fast move means paying near a short-term high, and quick moves often pull back.`,
      });
    }
  }

  const mid = (quote.bid + quote.ask) / 2;
  const spread = quote.ask - quote.bid;
  if (mid > 0 && spread / mid > WIDE_SPREAD) {
    warnings.push({
      code: 'wide_spread',
      message: `The spread is wide: ${fmtUsd(spread)} (${fmtPct(spread / mid, 2)} of the price). You pay the ask but could only sell at the bid right now, so this trade starts about ${fmtUsd(spread * req.qty)} down.`,
    });
  }
  return { warnings, breaks };
}
