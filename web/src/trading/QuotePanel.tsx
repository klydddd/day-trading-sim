import { fmtPct, fmtUsd } from '../../../shared/money';
import type { Candle, Print, Quote } from '../../../shared/types';
import { Term } from '../learn/Term';

export function QuotePanel({ symbol, quote, print, candles }: { symbol: string; quote?: Quote; print?: Print; candles: Candle[] }) {
  const spread = quote ? quote.ask - quote.bid : undefined;
  const mid = quote ? (quote.ask + quote.bid) / 2 : undefined;
  const hi = candles.length ? Math.max(...candles.map((c) => c.h)) : undefined;
  const lo = candles.length ? Math.min(...candles.map((c) => c.l)) : undefined;
  const vol = candles.reduce((a, c) => a + c.v, 0);
  const cell = (label: React.ReactNode, value: React.ReactNode) => (
    <div className="flex flex-col px-3 py-1.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="num font-semibold">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-wrap items-stretch divide-x divide-rule" aria-label={`${symbol} quote`} data-tour="quote">
      {cell(<Term id="bid">Bid</Term>, quote ? fmtUsd(quote.bid) : '–')}
      {cell(<Term id="ask">Ask</Term>, quote ? fmtUsd(quote.ask) : '–')}
      {cell(<Term id="spread">Spread</Term>, spread !== undefined && mid ? `${fmtUsd(spread)} (${fmtPct(spread / mid, 2)})` : '–')}
      {cell(<Term id="last">Last</Term>, print ? fmtUsd(print.price) : '–')}
      {cell('Day high / low', hi !== undefined ? `${fmtUsd(hi!)} / ${fmtUsd(lo!)}` : '–')}
      {cell(<Term id="volume">Volume</Term>, vol ? vol.toLocaleString('en-US') : '–')}
    </div>
  );
}
