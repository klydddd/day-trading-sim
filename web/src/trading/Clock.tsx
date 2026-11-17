import { DateTime } from 'luxon';
import { ET } from '../../../shared/market';
import type { MarketPhase } from '../../../shared/protocol';

const PHASE: Record<MarketPhase, string> = { pre: 'Pre-market', open: 'Market open', closed: 'Market closed' };

/** Always US Eastern, always labeled. With showDate false (Challenge + Replay) no date is rendered. */
export function Clock({ ts, phase, showDate }: { ts: number; phase: MarketPhase; showDate: boolean }) {
  const d = DateTime.fromMillis(ts, { zone: ET });
  return (
    <div className="num text-[13px] whitespace-nowrap" aria-label="Market clock">
      {showDate && <span className="text-muted mr-2">{d.toFormat('ccc LLL d')}</span>}
      <span className="font-semibold">{`${d.toFormat('HH:mm:ss')} ET · ${PHASE[phase]}`}</span>
    </div>
  );
}
