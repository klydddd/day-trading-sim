import { useEffect, useState } from 'react';
import type { ClientMessage } from '../../../shared/protocol';
import { useHelp } from './HelpContext';

const STEPS: { target: string; title: string; body: string }[] = [
  { target: 'watchlist', title: 'Pick a symbol', body: 'Click a symbol in the watchlist. Its chart and quote load in the middle of the screen.' },
  { target: 'quote', title: 'Read the bid and ask', body: 'The ask is the price you pay to buy now; the bid is what you get selling now. The gap between them is the spread, a cost you pay on every round trip.' },
  { target: 'qty', title: 'Set a quantity', body: 'Type how many shares to buy. Small sizes are fine while learning, such as 10 shares.' },
  { target: 'bracket', title: 'Add a stop-loss', body: 'Enter a stop-loss below the ask. If the price falls to it, your shares sell automatically, which caps how much you can lose.' },
  { target: 'pretrade', title: 'Read the explanation', body: 'The note under the ticket says in dollars what you are spending and what you risk if the stop is hit. Check it matches what you intended.' },
  { target: 'submit', title: 'Submit', body: 'Press Buy. A market order fills right away at the ask, and your stop-loss starts working.' },
  { target: 'positions', title: 'Watch the position', body: 'Your shares appear here with their profit or loss at the current bid. The stop shows as a dashed line on the chart.' },
  { target: 'positions', title: 'Close it', body: 'Press Close to sell all shares at the bid. The finished trade goes into your journal for the end-of-session review.' },
];

/** First-session guided tour. Skippable. Never available in Challenge. */
export function Walkthrough({ done, onSend, onDone }: { done: boolean; onSend: (m: ClientMessage) => void; onDone: () => void }) {
  const { learn } = useHelp();
  const [i, setI] = useState(0);
  const active = learn && !done;

  useEffect(() => {
    if (!active) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${STEPS[i].target}"]`);
    el?.classList.add('ring-2', 'ring-tutor', 'ring-offset-2', 'ring-offset-ink');
    return () => el?.classList.remove('ring-2', 'ring-tutor', 'ring-offset-2', 'ring-offset-ink');
  }, [i, active]);

  if (!active) return null;
  const finish = () => { onSend({ type: 'set_setting', key: 'walkthroughDone', value: true }); onDone(); };
  const step = STEPS[i];
  return (
    <aside className="tutor panel fixed bottom-4 left-4 z-40 w-80 p-4 shadow-lg" aria-label="Guided tour">
      <div className="text-[12px] text-muted">Step {i + 1} of {STEPS.length}</div>
      <h2 className="mt-1 font-semibold text-tutor">{step.title}</h2>
      <p className="mt-1 text-[13px]">{step.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button className="text-[13px] text-muted underline" onClick={finish}>Skip tour</button>
        <span className="flex-1" />
        {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
        {i < STEPS.length - 1
          ? <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>
          : <button className="btn btn-primary" onClick={finish}>Finish</button>}
      </div>
    </aside>
  );
}
