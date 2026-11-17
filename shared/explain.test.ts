import { explainOrder } from './explain';
import type { Quote } from './types';

const q: Quote = { symbol: 'AAPL', bid: 187.38, ask: 187.4, ts: 0 };

describe('explainOrder', () => {
  it('explains a bracketed buy in dollars (spec copy)', () => {
    expect(explainOrder({ symbol: 'AAPL', side: 'buy', qty: 20, type: 'market', bracket: { stopLoss: 186, takeProfit: 190 } }, q, 25000))
      .toBe('Buying 20 shares of AAPL at ~$187.40 = $3,748. Your stop at $186.00 risks $28 (0.1% of your account). Your target at $190.00 would make $52.');
  });
  it('explains a buy without a stop', () => {
    expect(explainOrder({ symbol: 'AAPL', side: 'buy', qty: 20, type: 'market' }, q, 25000))
      .toBe("Buying 20 shares of AAPL at ~$187.40 = $3,748. You have no stop-loss, so your possible loss isn't limited.");
  });
  it('uses the limit price for limit orders and singular share', () => {
    expect(explainOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 186.5, bracket: { stopLoss: 185 } }, q, 25000))
      .toBe('Buying 1 share of AAPL at ~$186.50 = $187. Your stop at $185.00 risks $2 (0.0% of your account).');
  });
  it('explains a sell at the bid', () => {
    expect(explainOrder({ symbol: 'AAPL', side: 'sell', qty: 20, type: 'market' }, q, 25000))
      .toBe('Selling 20 shares of AAPL at ~$187.38 = $3,748.');
  });
});
