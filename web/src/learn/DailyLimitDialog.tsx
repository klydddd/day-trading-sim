import type { ClientMessage } from '../../../shared/protocol';
import { useHelp } from './HelpContext';

/** Learn mode: trading pauses at the daily loss limit; the user may override, and that is recorded. */
export function DailyLimitDialog({ onSend }: { onSend: (m: ClientMessage) => void }) {
  const { learn } = useHelp();
  if (!learn) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70" role="dialog" aria-modal="true" aria-labelledby="dl-title">
      <div className="panel max-w-md p-5">
        <h2 id="dl-title" className="text-lg font-bold">You've reached your daily loss limit</h2>
        <p className="mt-2 text-[14px]">
          New buys are paused for the rest of this session. Professional traders stop at their limit because losses
          after a bad stretch tend to come from frustration, not from a plan. You can still close or manage what you hold.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button className="btn" onClick={() => onSend({ type: 'end_session' })}>End the session and review</button>
          <button className="btn border-tutor text-tutor" onClick={() => onSend({ type: 'override_daily_limit' })}>
            Override and keep trading (this will be recorded)
          </button>
        </div>
      </div>
    </div>
  );
}
