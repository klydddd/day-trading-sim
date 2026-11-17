import { DateTime } from 'luxon';

export const ET = 'America/New_York';
export interface TradingDay { date: string; open: number; close: number } // epoch ms, ET-correct

const et = (ts: number) => DateTime.fromMillis(ts, { zone: ET });
const ampm = (d: DateTime) => d.toFormat('h:mma').toLowerCase();

/** Epoch ms for an ET wall-clock time on a date. */
export function etTime(date: string, hhmm: string): number {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: ET }).toMillis();
}

export function etDate(ts: number): string {
  return et(ts).toISODate() as string;
}

/** Regular-hours phase. 'pre' is 4:00am ET until the open on a trading day. */
export function marketPhase(now: number, day?: TradingDay): 'pre' | 'open' | 'closed' {
  if (!day) return 'closed';
  if (now >= day.open && now < day.close) return 'open';
  if (now < day.open && etDate(now) === day.date && et(now).hour >= 4) return 'pre';
  return 'closed';
}

/**
 * "Market closed, opens Mon 9:30am ET" / "Market open, closes 4:00pm ET".
 * `next` is the next open when closed, or the next close when open.
 */
export function marketStatusLabel(isOpen: boolean, next: number, now: number): string {
  const n = et(next);
  if (isOpen) return `Market open, closes ${ampm(n)} ET`;
  const when = etDate(next) === etDate(now) ? 'today' : n.toFormat('ccc');
  return `Market closed, opens ${when} ${ampm(n)} ET`;
}

/** Chart axis/crosshair label in ET. With hideDate (Challenge + Replay) no date leaks. */
export function formatChartTime(ts: number, hideDate: boolean): string {
  const d = et(ts);
  return hideDate ? d.toFormat('HH:mm') : d.toFormat('LLL d HH:mm');
}

export function formatClock(ts: number, withDate: boolean): string {
  const d = et(ts);
  return withDate ? d.toFormat('ccc LLL d, HH:mm:ss') : d.toFormat('HH:mm:ss');
}
