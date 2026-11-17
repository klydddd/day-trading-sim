import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { createChart, LineSeries, type UTCTimestamp } from 'lightweight-charts';
import { ET } from '../../../shared/market';
import { fmtUsd } from '../../../shared/money';
import { computeStats } from '../../../shared/stats';
import type { EndReason, SessionConfig, Trade } from '../../../shared/types';
import { Signed } from '../trading/AccountBar';

interface Row { id: string; config: SessionConfig; replayDate: string | null; startedAt: number; endedAt: number | null; endReason: EndReason | null; pnl: number; tradeCount: number }
type HelpFilter = 'learn' | 'challenge' | 'all';
type SourceFilter = 'live' | 'replay' | 'all';
const REASON: Record<EndReason, string> = { user: 'Ended by you', daily_limit: 'Daily loss limit', market_close: 'Market close' };

export function History({ onBack }: { onBack: () => void }) {
  const [help, setHelp] = useState<HelpFilter>('learn');
  const [source, setSource] = useState<SourceFilter>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<{ id: string; trades: Trade[] }>();

  useEffect(() => {
    const qs = new URLSearchParams();
    if (help !== 'all') qs.set('helpLevel', help);
    if (source !== 'all') qs.set('dataSource', source);
    fetch(`/api/sessions?${qs}`).then((r) => r.json()).then((d: Row[]) => { setRows(d.filter((x) => x.endedAt)); setError(undefined); })
      .catch(() => setError('Could not load past sessions from the local server.'));
  }, [help, source]);

  const pick = (id: string) => fetch(`/api/sessions/${id}/trades`).then((r) => r.json()).then((trades: Trade[]) => setPicked({ id, trades }));
  const total = rows.reduce((a, r) => a + r.pnl, 0);
  const trades = rows.reduce((a, r) => a + r.tradeCount, 0);
  const green = rows.filter((r) => r.pnl > 0).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Past sessions</h1>
        <button className="underline text-muted" onClick={onBack}>Back to new session</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2">Help
          <select value={help} onChange={(e) => setHelp(e.target.value as HelpFilter)}>
            <option value="learn">Learn</option><option value="challenge">Challenge</option><option value="all">All</option>
          </select>
        </label>
        <label className="flex items-center gap-2">Prices
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option value="all">Live and Replay</option><option value="live">Live</option><option value="replay">Replay</option>
          </select>
        </label>
      </div>
      {error && <p role="alert" className="mt-4 text-down">{error}</p>}

      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sessions" value={String(rows.length)} />
        <Stat label="Total P&L" value={<Signed v={total} />} />
        <Stat label="Trades" value={String(trades)} />
        <Stat label="Profitable sessions" value={rows.length ? `${green} of ${rows.length}` : '–'} />
      </section>

      <section className="panel mt-4 h-56 p-2" aria-label="Cumulative P&L">
        {rows.length > 0 ? <EquityCurve rows={rows} /> : <p className="p-4 text-muted">No finished sessions yet for this filter. Finish a session and it shows up here.</p>}
      </section>

      <table className="mt-4 w-full text-[13px]">
        <thead className="text-left text-muted"><tr>
          <th className="py-1 font-normal">Date</th><th className="font-normal">Mode</th><th className="font-normal">P&L</th>
          <th className="font-normal">Trades</th><th className="font-normal">Ended</th>
        </tr></thead>
        <tbody>
          {rows.slice().reverse().map((r) => (
            <tr key={r.id} className={`cursor-pointer border-t border-rule/50 hover:bg-raised ${picked?.id === r.id ? 'bg-raised' : ''}`} onClick={() => pick(r.id)}>
              <td className="py-1.5 num">{DateTime.fromMillis(r.startedAt, { zone: ET }).toFormat('LLL d, yyyy')}{r.replayDate ? <span className="text-muted"> (replay of {r.replayDate})</span> : ''}</td>
              <td>{r.config.helpLevel === 'learn' ? 'Learn' : 'Challenge'}, {r.config.dataSource === 'live' ? 'Live' : 'Replay'}</td>
              <td><Signed v={r.pnl} /></td>
              <td className="num">{r.tradeCount}</td>
              <td className="text-muted">{r.endReason ? REASON[r.endReason] : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {picked && <SessionDetail trades={picked.trades} />}
    </main>
  );
}

function SessionDetail({ trades }: { trades: Trade[] }) {
  const s = computeStats(trades);
  return (
    <section className="panel mt-4 p-3 text-[13px]">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>Win rate <strong className="num">{s.count ? `${Math.round(s.winRate * 100)}%` : '–'}</strong></span>
        <span>Avg win <strong className="num">{fmtUsd(s.avgWin)}</strong></span>
        <span>Avg loss <strong className="num">{fmtUsd(s.avgLoss)}</strong></span>
        <span>Biggest loss <strong className="num">{s.biggestLoss ? `-${fmtUsd(s.biggestLoss)}` : '–'}</strong></span>
        <span>Rules followed <strong className="num">{s.tradesFollowingRules} of {s.count}</strong></span>
      </div>
      <ul className="mt-2">
        {trades.filter((t) => t.closedAt).map((t) => (
          <li key={t.id} className="flex gap-3 border-t border-rule/50 py-1">
            <span className="font-semibold">{t.symbol}</span><Signed v={t.pnl} />
            {t.note && <span className="text-muted">“{t.note}”</span>}
            {t.ruleBreaks.length > 0 && <span className="text-down">{t.ruleBreaks.length} rule break{t.ruleBreaks.length > 1 ? 's' : ''}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="panel p-3"><div className="text-[12px] text-muted">{label}</div><div className="num mt-1 text-lg font-bold">{value}</div></div>;
}

function EquityCurve({ rows }: { rows: Row[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#8a97aa' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1f2836' } },
      timeScale: { borderColor: '#2a3546' }, rightPriceScale: { borderColor: '#2a3546' },
    });
    const line = chart.addSeries(LineSeries, { color: '#dce3ec', lineWidth: 2 });
    let cum = 0;
    let lastT = 0;
    line.setData(rows.map((r) => {
      cum += r.pnl;
      lastT = Math.max(lastT + 1, Math.floor((r.endedAt ?? r.startedAt) / 1000));
      return { time: lastT as UTCTimestamp, value: Math.round(cum * 100) / 100 };
    }));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [rows]);
  return <div ref={el} className="h-full w-full" />;
}
