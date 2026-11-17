import type { Note } from '../../../shared/types';
import { useHelp } from './HelpContext';

const TITLE: Record<Note['code'], string> = {
  stop_slippage: 'Your stop filled with slippage',
  limit_touched_no_fill: "Why your limit didn't fill",
  iex_volume: 'About live volume',
  modeled_spread: 'About replay prices',
};

/** A dismissible toast for each notable event. Learn only (the server never sends notes in Challenge). */
export function EventNotes({ notes, onDismiss }: { notes: Note[]; onDismiss: (ts: number) => void }) {
  const { learn } = useHelp();
  if (!learn || notes.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-96 flex-col gap-2" aria-live="polite">
      {notes.slice(-3).map((n) => (
        <div key={`${n.code}-${n.ts}`} className="tutor panel flex gap-2 p-3 text-[13px] shadow-lg" role="status">
          <div className="flex-1">
            <div className="font-semibold text-tutor">{TITLE[n.code]}</div>
            <p className="mt-1">{n.message}</p>
          </div>
          <button aria-label="Dismiss note" className="self-start text-muted" onClick={() => onDismiss(n.ts)}>×</button>
        </div>
      ))}
    </div>
  );
}
