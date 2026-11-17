import type { ReplaySpeed } from '../../../shared/protocol';
import { Term } from '../learn/Term';

const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10];
type Action = 'play' | 'pause' | 'step' | 'speed';

/** Play/pause, speed and +1 min. Deliberately no back button: rewinding would show the future. */
export function ReplayControls({ playing, speed, locked, onAction }: {
  playing: boolean; speed: number; locked: boolean; onAction: (a: Action, speed?: ReplaySpeed) => void;
}) {
  return (
    <div className="flex items-center gap-1" aria-label="Replay controls">
      <span className="mr-1 text-[12px] text-muted"><Term id="replay">Replay</Term></span>
      <button className="btn w-16" onClick={() => onAction(playing ? 'pause' : 'play')}>{playing ? 'Pause' : 'Play'}</button>
      <button className="btn" disabled={playing} title={playing ? 'Pause to jump ahead' : undefined} onClick={() => onAction('step')}>+1 min</button>
      <div className="ml-2 flex" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} className={`btn px-2 ${s === speed ? 'bg-text text-ink' : ''}`} aria-pressed={s === speed}
            disabled={locked} title={locked ? 'Speed is locked in Challenge' : undefined}
            onClick={() => onAction('speed', s)}>{`${s}×`}</button>
        ))}
      </div>
    </div>
  );
}
