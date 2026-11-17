import { useState } from 'react';
import { DateTime } from 'luxon';
import { ET } from '../../../shared/market';
import { fmtPct, fmtUsd } from '../../../shared/money';
import type { ClientMessage, Review as ReviewT } from '../../../shared/protocol';
import type { Candle, Trade } from '../../../shared/types';
import { Signed } from '../trading/AccountBar';
import { Chart } from '../trading/Chart';
import { Term } from '../learn/Term';

const REASON: Record<ReviewT['reason'], string> = {
  user: 'You ended the session.',
  daily_limit: 'The session ended because you reached your daily loss limit.',
  market_close: 'The session ended at the market close. Open positions were sold at the bid.',
};
const t = (ms?: number) => (ms ? DateTime.fromMillis(ms, { zone: ET }).toFormat('HH:mm:ss') : '–');

export function Review({ review, candles, onSend, onNewSession }: {
  review: ReviewT; candles: Record<string, Candle[]>; onSend: (m: ClientMessage) => void; onNewSession: () => void;
}) {
  const { config, stats } = review;
  const challenge = config.helpLevel === 'challenge';
  const [open, setOpen] = useState<string | undefined>();
  const date = review.replayDate ? DateTime.fromISO(review.replayDate, { zone: ET }).toFormat('ccc, LLL d, yyyy') : undefined;
  const breaks = stats.ruleBreaks + review.overrides.length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Session review</h1>
          <p className="mt-1 text-muted">
            {challenge ? 'Challenge' : 'Learn'}, {config.dataSource === 'replay' ? <>replay of <strong className="text-text">{date}</strong></> : 'live'}. {REASON[review.reason]}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onNewSession}>New session</button>
      </div>

      {challenge && review.profitTarget && (
        <section className={`mt-6 rounded-md border p-4 ${review.profitTarget.passed ? 'border-up' : 'border-down'}`}>
          <div className="text-xl font-bold">{review.profitTarget.passed ? 'Passed' : 'Not passed'}</div>
          <p className="mt-1 text-[14px] text-muted">
            Profit target of {review.profitTarget.targetPct}% ({fmtUsd((config.startingCash * review.profitTarget.targetPct) / 100, 0)}): {review.profitTarget.hit ? 'hit' : 'missed'}.
            {' '}Rules broken: {breaks}. Passing needs the target hit with no rules broken.
          </p>
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Stats">
        <Tile label="P&L"><Signed v={review.sessionPnl} className="text-lg font-bold" /></Tile>
        <Tile label="Trades"><span className="num text-lg font-bold">{stats.count}</span></Tile>
        <Tile label={<Term id="winRate">Win rate</Term>}><span className="num text-lg font-bold">{stats.count ? fmtPct(stats.winRate, 0) : '–'}</span></Tile>
        <Tile label={<Term id="avgWinLoss">Avg win / avg loss</Term>}><span className="num text-lg font-bold">{fmtUsd(stats.avgWin)} / {fmtUsd(stats.avgLoss)}</span></Tile>
        <Tile label="Biggest loss"><span className="num text-lg font-bold">{stats.biggestLoss ? `-${fmtUsd(stats.biggestLoss)}` : '–'}</span></Tile>
        <Tile label="Rules followed"><span className="num text-lg font-bold">{stats.tradesFollowingRules} of {stats.count} trades</span>{breaks > 0 && <span className="block text-[12px] text-down">{breaks} broken</span>}</Tile>
      </section>

      {!challenge && review.observations && (
        <section className="mt-6">
          <h2 className="font-semibold">What stood out</h2>
          {review.observations.length === 0 ? <p className="mt-2 text-muted">Nothing unusual this session.</p> : (
            <ul className="mt-2 flex flex-col gap-1">{review.observations.map((o) => <li key={o} className="tutor p-2 text-[14px]">{o}</li>)}</ul>
          )}
        </section>
      )}

      {review.overrides.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">Overrides</h2>
          <ul className="mt-1 text-[14px] text-down">{review.overrides.map((o) => <li key={o.ts}>{o.detail}</li>)}</ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold">Trades</h2>
        {review.trades.length === 0 ? <p className="mt-2 text-muted">No trades this session.</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {review.trades.map((tr) => (
              <TradeRow key={tr.id} trade={tr} open={open === tr.id} onToggle={() => setOpen(open === tr.id ? undefined : tr.id)}
                candles={candles[tr.symbol] ?? []} hideDate={false} onSend={onSend} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Tile({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function TradeRow({ trade, open, onToggle, candles, hideDate, onSend }: {
  trade: Trade; open: boolean; onToggle: () => void; candles: Candle[]; hideDate: boolean; onSend: (m: ClientMessage) => void;
}) {
  const [note, setNote] = useState(trade.note ?? '');
  const [saved, setSaved] = useState(false);
  const window = candles.filter((c) => c.t >= trade.openedAt - 30 * 60_000 && c.t <= (trade.closedAt ?? trade.openedAt) + 30 * 60_000);
  return (
    <li className="panel">
      <button className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="font-semibold">{trade.symbol}</span>
        <span className="num text-[13px] text-muted">{t(trade.openedAt)}–{t(trade.closedAt)} ET</span>
        <span className="num text-[13px]">{trade.maxQty} sh, {fmtUsd(trade.avgEntry)} → {trade.avgExit !== undefined ? fmtUsd(trade.avgExit) : '–'}</span>
        <span className="num text-[13px] text-muted">stop {trade.stopUsed !== undefined ? fmtUsd(trade.stopUsed) : 'none'}, target {trade.targetUsed !== undefined ? fmtUsd(trade.targetUsed) : 'none'}</span>
        <span className="ml-auto"><Signed v={trade.pnl} /></span>
      </button>
      {trade.ruleBreaks.length > 0 && (
        <ul className="px-3 pb-2 text-[13px] text-down">{trade.ruleBreaks.map((b, i) => <li key={i}>{b.detail}</li>)}</ul>
      )}
      {open && (
        <div className="border-t border-rule p-3">
          {window.length > 0 && (
            <div className="h-64"><Chart symbol={trade.symbol} candles={window} fills={trade.fills} orders={[]} hideDate={hideDate} showControls={false} height={256} /></div>
          )}
          <label className="mt-3 flex flex-col gap-1 text-[13px]">Note
            <textarea rows={2} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="Why did you take it? What would you do differently?" />
          </label>
          <button className="btn mt-2" onClick={() => { onSend({ type: 'save_note', tradeId: trade.id, note }); setSaved(true); }}>{saved ? 'Saved' : 'Save note'}</button>
        </div>
      )}
    </li>
  );
}
