import { useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { marketStatusLabel, ET } from '../../../shared/market';
import { DEFAULT_STARTING_CASH, type DataSource, type HelpLevel, type Limit, type SessionConfig } from '../../../shared/types';
import type { ClientSettings, ServerMessage } from '../../../shared/protocol';
import { Term } from '../learn/Term';

type Market = Extract<ServerMessage, { type: 'status' }>['market'];

/** Most recent weekday before today (ET). The server checks it against the real market calendar. */
export function defaultReplayDate(now: number): string {
  let d = DateTime.fromMillis(now, { zone: ET }).minus({ days: 1 });
  while (d.weekday > 5) d = d.minus({ days: 1 });
  return d.toISODate()!;
}

interface Props {
  market: Market; settings: ClientSettings; now: number;
  onStart: (c: SessionConfig) => void; onHistory: () => void;
  initialDataSource?: DataSource;
}

export function SessionSetup({ market, settings, now, onStart, onHistory, initialDataSource }: Props) {
  const [dataSource, setDataSource] = useState<DataSource>(initialDataSource ?? (market.isOpen ? 'live' : 'replay'));
  const [helpLevel, setHelpLevel] = useState<HelpLevel>('learn');
  const [cash, setCash] = useState(String(DEFAULT_STARTING_CASH));
  const [perTrade, setPerTrade] = useState<Limit>(settings.rules.maxLossPerTrade);
  const [daily, setDaily] = useState<Limit>(settings.rules.dailyLossLimit);
  const [requireStop, setRequireStop] = useState(settings.rules.requireStop);
  const [date, setDate] = useState(defaultReplayDate(now));
  const [time, setTime] = useState('09:30');
  const [target, setTarget] = useState('');
  const [fee, setFee] = useState(String(settings.feePerShare));
  const liveClosed = !market.isOpen;
  const statusLabel = market.nextOpen || market.nextClose
    ? marketStatusLabel(market.isOpen, market.isOpen ? market.nextClose : market.nextOpen, now)
    : 'Market status unknown';
  const challenge = helpLevel === 'challenge';
  const cashNum = Number(cash);
  const valid = cashNum > 0 && perTrade.value > 0 && daily.value > 0 && (dataSource === 'replay' || !liveClosed);

  const start = () => {
    const config: SessionConfig = {
      dataSource, helpLevel, startingCash: cashNum,
      rules: { maxLossPerTrade: perTrade, dailyLossLimit: daily, requireStop },
      feePerShare: Math.max(0, Number(fee) || 0),
    };
    if (dataSource === 'replay' && !challenge) { config.replayDate = date; config.replayStartTime = time; }
    if (challenge && Number(target) > 0) config.profitTargetPct = Number(target);
    onStart(config);
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">New practice session</h1>
        <button className="underline text-muted" onClick={onHistory}>Past sessions</button>
      </div>
      <p className="mt-1 text-muted">Virtual money, real prices. Nothing here touches a real brokerage account.</p>

      <Section title="Prices">
        <div role="radiogroup" aria-label="Prices" className="grid grid-cols-2 gap-3">
          <Choice name="ds" checked={dataSource === 'live'} disabled={liveClosed} onChange={() => setDataSource('live')}
            label="Live" desc="Today's market as it happens." />
          <Choice name="ds" checked={dataSource === 'replay'} onChange={() => setDataSource('replay')}
            label="Replay" desc="A real past day played back. No rewinding." />
        </div>
        {liveClosed && (
          <div className="mt-3 flex items-center gap-3 text-[13px]">
            <span className="text-muted">{statusLabel}</span>
            {dataSource === 'live' && <button className="btn" onClick={() => setDataSource('replay')}>Start a Replay instead</button>}
          </div>
        )}
      </Section>

      <Section title="Help">
        <div role="radiogroup" aria-label="Help" className="grid grid-cols-2 gap-3">
          <Choice name="hl" checked={helpLevel === 'learn'} onChange={() => setHelpLevel('learn')}
            label="Learn" desc="Explanations, term definitions and warnings as you trade." />
          <Choice name="hl" checked={helpLevel === 'challenge'} onChange={() => setHelpLevel('challenge')}
            label="Challenge" desc="No help at all. Rule breaks show up only in the review. Hitting the daily loss limit ends the session." />
        </div>
      </Section>

      {dataSource === 'replay' && (
        <Section title="Replay day">
          {challenge ? (
            <p className="text-muted">A random past trading day will be picked. You'll see which one at the end.</p>
          ) : (
            <div className="flex gap-4">
              <label className="flex flex-col gap-1">Replay date
                <input type="date" value={date} max={defaultReplayDate(now)} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">Start time (ET)
                <input type="time" value={time} min="09:30" max="15:59" onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          )}
        </Section>
      )}

      <Section title="Account and rules">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">Starting balance ($)
            <input className="num" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
            <span className="text-[12px] text-muted">$25,000 is the minimum US brokers require to day trade freely (the <Term id="pdt">pattern day trader rule</Term>).</span>
          </label>
          {challenge && (
            <label className="flex flex-col gap-1">Profit target (% of account, optional)
              <input className="num" inputMode="decimal" placeholder="e.g. 2" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
          )}
          <LimitInput label={<><Term id="riskPerTrade">Max loss per trade</Term></>} value={perTrade} onChange={setPerTrade} />
          <LimitInput label={<><Term id="dailyLossLimit">Daily loss limit</Term></>} value={daily} onChange={setDaily} />
          <label className="flex items-center gap-2 col-span-2">
            <input type="checkbox" checked={requireStop} onChange={(e) => setRequireStop(e.target.checked)} />
            Every entry needs a <Term id="stopLoss">stop-loss</Term>
          </label>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-muted">Advanced</summary>
          <label className="mt-2 flex items-center gap-2">Fee per share ($)
            <input className="num w-24" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        </details>
      </Section>

      <div className="mt-8">
        <button className="btn btn-primary px-6 py-2" disabled={!valid} onClick={start}>Start session</button>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ name, label, desc, checked, disabled, onChange }: {
  name: string; label: string; desc: string; checked: boolean; disabled?: boolean; onChange: () => void;
}) {
  const id = `${name}-${label}`;
  return (
    <div className={`panel p-3 ${checked ? 'border-text' : ''} ${disabled ? 'opacity-50' : ''}`}>
      <input id={id} type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} aria-describedby={`${id}-d`} className="mr-2" />
      <label htmlFor={id} className="font-semibold">{label}</label>
      <p id={`${id}-d`} className="mt-1 text-[13px] text-muted">{desc}</p>
    </div>
  );
}

function LimitInput({ label, value, onChange }: { label: ReactNode; value: Limit; onChange: (l: Limit) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span>{label}</span>
      <div className="flex gap-2">
        <input className="num w-24" inputMode="decimal" value={value.value}
          onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })} />
        <select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as Limit['kind'] })}>
          <option value="percent">% of balance</option>
          <option value="dollars">dollars</option>
        </select>
      </div>
    </div>
  );
}
