import { fmtPct, fmtUsd } from '../../../shared/money';
import type { ClientMessage } from '../../../shared/protocol';
import type { Position, Print, Quote } from '../../../shared/types';
import { Term } from '../learn/Term';
import { Signed } from './AccountBar';

export function Positions({ positions, prices, onSend }: {
  positions: Position[]; prices: Record<string, { quote?: Quote; print?: Print }>; onSend: (m: ClientMessage) => void;
}) {
  return (
    <div data-tour="positions">
      <div className="panel-title"><Term id="position">Positions</Term></div>
      {positions.length === 0 ? <p className="px-3 py-2 text-[13px] text-muted">No open positions.</p> : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-muted"><tr>
            <th className="px-3 py-1 font-normal">Symbol</th><th className="font-normal">Shares</th><th className="font-normal">Avg price</th>
            <th className="font-normal"><Term id="unrealizedPnl">Unrealized P&L</Term></th><th />
          </tr></thead>
          <tbody>
            {positions.map((p) => {
              const bid = prices[p.symbol]?.quote?.bid;
              const pnl = bid !== undefined ? (bid - p.avgPrice) * p.qty : 0;
              const pct = bid !== undefined ? (bid - p.avgPrice) / p.avgPrice : 0;
              return (
                <tr key={p.symbol} className="border-t border-rule/50">
                  <td className="px-3 py-1 font-semibold">{p.symbol}</td>
                  <td className="num">{p.qty}</td>
                  <td className="num">{fmtUsd(p.avgPrice)}</td>
                  <td><Signed v={pnl} /> <span className="num text-muted">({pct >= 0 ? '+' : ''}{fmtPct(pct, 2)})</span></td>
                  <td className="pr-2 text-right"><button className="btn" onClick={() => onSend({ type: 'close_position', symbol: p.symbol })}>Close</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
