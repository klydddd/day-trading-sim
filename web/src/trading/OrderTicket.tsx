import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtUsd } from '../../../shared/money';
import type { ClientMessage } from '../../../shared/protocol';
import type { Order, OrderRequest, OrderType, Quote, RejectReason, Side } from '../../../shared/types';
import { useHelp } from '../learn/HelpContext';
import { Term } from '../learn/Term';

export const dollarsToShares = (amount: number, ask: number): number => (ask > 0 && amount > 0 ? Math.floor(amount / ask) : 0);

export const REJECT_WORDS: Record<RejectReason, string> = {
  no_quote: 'There is no price for this symbol yet. Wait for a quote, then try again.',
  stale_data: 'Prices are out of date (no fresh quote in the last 5 seconds), so market orders are blocked until live data is back.',
  insufficient_cash: "You don't have enough cash for this order. Working buy orders also reserve cash.",
  no_position: "You don't own shares of this symbol, so there is nothing to sell. Short selling isn't allowed here.",
  invalid_qty: 'Quantity must be a whole number of shares above zero.',
  invalid_price: "That price doesn't work for this order. A stop-loss must be below the entry price and a take-profit above it.",
  unsupported: "That order type isn't available. Stop orders can only sell.",
  daily_limit: "You've reached your daily loss limit, so new buys are paused.",
  session_ended: 'The session has ended.',
};

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

interface Props {
  symbol: string; quote?: Quote; startingCash: number; onSend: (m: ClientMessage) => void;
  lastReject?: Order; onDismissReject?: () => void;
  focusRequest?: { side: Side; n: number };
  children?: (req: OrderRequest | undefined) => React.ReactNode; // Learn layer slot (explanation + warnings)
}

export function OrderTicket({ symbol, quote, startingCash, onSend, lastReject, onDismissReject, focusRequest, children }: Props) {
  const { learn } = useHelp();
  const [side, setSide] = useState<Side>('buy');
  const [mode, setMode] = useState<'shares' | 'dollars'>('shares');
  const [qtyStr, setQty] = useState('');
  const [amountStr, setAmount] = useState('');
  const [type, setType] = useState<OrderType>('market');
  const [priceStr, setPrice] = useState('');
  const [stopStr, setStop] = useState('');
  const [targetStr, setTarget] = useState('');
  const [note, setNote] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  void startingCash;

  useEffect(() => {
    if (!focusRequest) return;
    setSide(focusRequest.side);
    if (focusRequest.side === 'buy' && type === 'stop') setType('market');
    qtyRef.current?.focus();
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = mode === 'shares' ? (num(qtyStr) ?? 0) : dollarsToShares(num(amountStr) ?? 0, quote?.ask ?? 0);
  const price = num(priceStr);
  const stop = side === 'buy' ? num(stopStr) : undefined;
  const target = side === 'buy' ? num(targetStr) : undefined;
  const entryRef = type === 'limit' ? price : (side === 'buy' ? quote?.ask : quote?.bid);

  const errors: string[] = [];
  if ((mode === 'shares' ? qtyStr : amountStr) !== '' && !(Number.isInteger(qty) && qty > 0)) {
    errors.push(mode === 'shares' ? 'Quantity must be a whole number of shares above zero.' : 'That amount buys less than one share.');
  }
  if (type !== 'market' && priceStr !== '' && !(price! > 0)) errors.push('Enter a price above zero.');
  if (stop !== undefined && entryRef !== undefined && !(stop > 0 && stop < entryRef)) errors.push(`The stop-loss must be below the entry price (${fmtUsd(entryRef)}).`);
  if (target !== undefined && entryRef !== undefined && !(target > entryRef)) errors.push(`The take-profit must be above the entry price (${fmtUsd(entryRef)}).`);

  const req: OrderRequest | undefined = useMemo(() => {
    if (!(Number.isInteger(qty) && qty > 0)) return undefined;
    if (type !== 'market' && !(price! > 0)) return undefined;
    const r: OrderRequest = { symbol, side, qty, type };
    if (type === 'limit') r.limitPrice = price;
    if (type === 'stop') r.stopPrice = price;
    if (side === 'buy' && (stop !== undefined || target !== undefined)) {
      r.bracket = {};
      if (stop !== undefined) r.bracket.stopLoss = stop;
      if (target !== undefined) r.bracket.takeProfit = target;
    }
    if (note.trim()) r.note = note.trim();
    return r;
  }, [symbol, side, qty, type, price, stop, target, note]);
  const valid = Boolean(req) && errors.length === 0;

  useEffect(() => {
    if (!req || !valid || req.side !== 'buy') return;
    const h = setTimeout(() => onSend({ type: 'preview_order', req }), 300);
    return () => clearTimeout(h);
  }, [JSON.stringify(req), valid]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!req || !valid) return;
    onSend({ type: 'submit_order', req });
    setNote('');
  };

  const typeLabel = type === 'market' ? 'at market' : type === 'limit' ? `limit ${priceStr ? fmtUsd(Number(priceStr)) : ''}` : `stop ${priceStr ? fmtUsd(Number(priceStr)) : ''}`;
  const reject = lastReject && lastReject.symbol === symbol && lastReject.rejectReason ? lastReject : undefined;

  return (
    <form className="panel flex flex-col gap-3 p-3" aria-label="Order ticket" data-tour="ticket" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{symbol}</span>
        <span className="num text-[12px] text-muted">{quote ? `${fmtUsd(quote.bid)} × ${fmtUsd(quote.ask)}` : 'No quote yet'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Side">
        <button type="button" aria-pressed={side === 'buy'} className={`btn ${side === 'buy' ? 'btn-buy' : ''}`} onClick={() => setSide('buy')}>Buy</button>
        <button type="button" aria-pressed={side === 'sell'} className={`btn ${side === 'sell' ? 'btn-sell' : ''}`}
          onClick={() => { setSide('sell'); }}>Sell</button>
      </div>

      <div className="flex gap-3 text-[13px]" role="radiogroup" aria-label="Size in">
        <label className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === 'shares'} onChange={() => setMode('shares')} /># shares</label>
        <label className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === 'dollars'} onChange={() => setMode('dollars')} />$ amount</label>
      </div>
      {mode === 'shares' ? (
        <label className="flex flex-col gap-1 text-[13px]" data-tour="qty">
          <span>Shares</span>
          <input ref={qtyRef} aria-label="Shares" className="num" inputMode="numeric" value={qtyStr} onChange={(e) => setQty(e.target.value)} />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-[13px]">
          <span>Dollar amount</span>
          <input ref={qtyRef} aria-label="Dollar amount" className="num" inputMode="decimal" value={amountStr} onChange={(e) => setAmount(e.target.value)} />
          <span className="text-muted">= {qty} {qty === 1 ? 'share' : 'shares'}</span>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <label className="flex flex-col gap-1">
          <span>Order type</span>
          <select value={type} onChange={(e) => setType(e.target.value as OrderType)}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            {side === 'sell' && <option value="stop">Stop</option>}
          </select>
        </label>
        {type !== 'market' && (
          <label className="flex flex-col gap-1">
            <span>{type === 'limit' ? 'Limit price' : 'Stop price'}</span>
            <input className="num" inputMode="decimal" value={priceStr} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
      </div>
      <p className="text-[12px] text-muted">
        {type === 'market' ? <><Term id="marketOrder">Market</Term>: fills now at the {side === 'buy' ? 'ask' : 'bid'}.</>
          : type === 'limit' ? <><Term id="limitOrder">Limit</Term>: fills only if the price trades through your price.</>
          : <><Term id="stopLoss">Stop</Term>: sells at the next price once the stop is hit.</>}
      </p>

      {side === 'buy' && (
        <fieldset className="grid grid-cols-2 gap-2 text-[13px]" data-tour="bracket">
          <legend className="mb-1 text-muted"><Term id="bracket">Bracket</Term> (sells automatically)</legend>
          <label className="flex flex-col gap-1">
            <span><Term id="stopLoss">Stop-loss</Term></span>
            <input aria-label="Stop-loss" className="num" inputMode="decimal" value={stopStr} onChange={(e) => setStop(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span><Term id="takeProfit">Take-profit</Term></span>
            <input aria-label="Take-profit" className="num" inputMode="decimal" value={targetStr} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-[13px]">
        <span>Note (optional)</span>
        <textarea rows={2} value={note} placeholder={learn ? 'Why are you taking this trade?' : ''} onChange={(e) => setNote(e.target.value)} />
      </label>

      {errors.length > 0 && <ul className="text-[13px] text-down">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {children?.(valid ? req : undefined)}

      <button type="submit" disabled={!valid} className={`btn py-2 ${side === 'buy' ? 'btn-buy' : 'btn-sell'}`} data-tour="submit">
        {`${side === 'buy' ? 'Buy' : 'Sell'} ${qty || ''} ${symbol} ${typeLabel}`.replace(/\s+/g, ' ').trim()}
      </button>
      {reject && (
        <div role="alert" className="flex items-start gap-2 rounded bg-down/15 p-2 text-[13px]">
          <span className="flex-1"><strong>Order rejected.</strong> {REJECT_WORDS[reject.rejectReason!]}</span>
          {onDismissReject && <button type="button" aria-label="Dismiss" onClick={onDismissReject}>×</button>}
        </div>
      )}
    </form>
  );
}
