import { useState } from 'react';
import { fmtPct, fmtUsd } from '../../../shared/money';
import { MAX_WATCHLIST, type Candle, type Print, type Quote } from '../../../shared/types';

export function lastPrice(p?: { quote?: Quote; print?: Print }): number | undefined {
  return p?.print?.price ?? (p?.quote ? (p.quote.bid + p.quote.ask) / 2 : undefined);
}

export function Watchlist({ symbols, prices, candles, selected, onSelect, onChange }: {
  symbols: string[]; prices: Record<string, { quote?: Quote; print?: Print }>; candles: Record<string, Candle[]>;
  selected?: string; onSelect: (s: string) => void; onChange: (symbols: string[]) => void;
}) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const sym = adding.trim().toUpperCase();
    if (/^[A-Z.]{1,10}$/.test(sym) && !symbols.includes(sym) && symbols.length < MAX_WATCHLIST) onChange([...symbols, sym]);
    setAdding('');
  };
  return (
    <div className="flex h-full flex-col">
      <div className="panel-title">Watchlist</div>
      <ul className="flex-1 overflow-y-auto">
        {symbols.map((s) => {
          const last = lastPrice(prices[s]);
          const first = candles[s]?.[0]?.o;
          const chg = last !== undefined && first ? (last - first) / first : undefined;
          const tone = chg === undefined || chg === 0 ? 'text-muted' : chg > 0 ? 'text-up' : 'text-down';
          return (
            <li key={s} className={`group flex items-center border-b border-rule/50 ${s === selected ? 'bg-raised' : ''}`}>
              <button className="flex flex-1 items-baseline justify-between px-3 py-1.5 text-left" onClick={() => onSelect(s)} aria-current={s === selected}>
                <span className="font-semibold">{s}</span>
                <span className="num text-right">
                  <span className="block">{last === undefined ? '–' : fmtUsd(last)}</span>
                  <span className={`block text-[12px] ${tone}`}>{chg === undefined ? '' : `${chg > 0 ? '▲ +' : chg < 0 ? '▼ ' : ''}${fmtPct(chg, 2)}`}</span>
                </span>
              </button>
              <button aria-label={`Remove ${s}`} className="px-2 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => onChange(symbols.filter((x) => x !== s))}>×</button>
            </li>
          );
        })}
      </ul>
      <form className="flex gap-1 border-t border-rule p-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input aria-label="Add symbol" className="w-full uppercase" placeholder="Add symbol" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button className="btn" disabled={symbols.length >= MAX_WATCHLIST}>Add</button>
      </form>
      <p className="px-2 pb-2 text-[11px] text-muted">{symbols.length}/{MAX_WATCHLIST} symbols (free data limit)</p>
    </div>
  );
}
