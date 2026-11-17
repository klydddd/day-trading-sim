import { explainOrder } from '../../../shared/explain';
import type { OrderRequest, Quote } from '../../../shared/types';
import { useHelp } from './HelpContext';

/** What the order means in dollars, before it is sent. Learn only. */
export function PreTrade({ req, quote, startingCash }: { req?: OrderRequest; quote?: Quote; startingCash: number }) {
  const { learn } = useHelp();
  if (!learn || !req || !quote) return null;
  return <p className="tutor p-2 text-[13px]" data-tour="pretrade">{explainOrder(req, quote, startingCash)}</p>;
}
