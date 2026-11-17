import { fmtSignedUsd, fmtUsd } from '../../../shared/money';
import type { DataStatus, ServerMessage } from '../../../shared/protocol';
import type { Rules } from '../../../shared/types';
import { Term } from '../learn/Term';

type Account = Extract<ServerMessage, { type: 'account' }>;

export const limitDollars = (l: Rules['dailyLossLimit'], startingCash: number) =>
  l.kind === 'percent' ? (startingCash * l.value) / 100 : l.value;

export function Signed({ v, className = '' }: { v: number; className?: string }) {
  const tone = v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-text';
  const arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '';
  return <span className={`num ${tone} ${className}`}>{arrow}{fmtSignedUsd(v)}</span>;
}

export function AccountBar({ account, rules, startingCash, live, dataStatus }: {
  account?: Account; rules: Rules; startingCash: number; live: boolean; dataStatus: DataStatus;
}) {
  const limit = limitDollars(rules.dailyLossLimit, startingCash);
  const pnl = account?.sessionPnl ?? 0;
  const left = Math.max(0, limit + Math.min(0, pnl));
  return (
    <div className="flex flex-col">
      {live && dataStatus !== 'connected' && (
        <div role="alert" className="mb-1 rounded bg-down/20 px-3 py-1 text-[13px] font-semibold text-down">
          Live data disconnected, reconnecting… Prices shown may be out of date.
        </div>
      )}
      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
        <Item label={<Term id="cash">Cash</Term>}><span className="num">{fmtUsd(account?.state.cash ?? startingCash)}</span></Item>
        <Item label={<Term id="equity">Equity</Term>}><span className="num">{fmtUsd(account?.equity ?? startingCash)}</span></Item>
        <Item label={<Term id="realizedPnl">Realized P&L</Term>}><Signed v={account?.state.realizedPnl ?? 0} /></Item>
        <Item label={<Term id="dailyLossLimit">Daily limit</Term>}>
          <span className={`num ${left < limit * 0.2 ? 'text-down font-semibold' : ''}`}>{fmtUsd(left, 0)} left before daily limit</span>
        </Item>
      </dl>
    </div>
  );
}

function Item({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
