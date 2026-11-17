export type Speed = 1 | 2 | 5 | 10;

/** Simulated time for Replay. Moves forward only: there is deliberately no way to go back. */
export class ReplayClock {
  private _simTs: number;
  private _playing = false;
  private _speed: Speed;
  private readonly locked: boolean;

  constructor(startTs: number, opts: { speed?: Speed; lockedSpeed?: boolean } = {}) {
    this._simTs = startTs;
    this.locked = Boolean(opts.lockedSpeed);
    this._speed = this.locked ? 1 : (opts.speed ?? 1);
  }

  get simTs(): number { return this._simTs; }
  get playing(): boolean { return this._playing; }
  get speed(): number { return this._speed; }
  get lockedSpeed(): boolean { return this.locked; }

  play(): void { this._playing = true; }
  pause(): void { this._playing = false; }

  setSpeed(s: Speed): void {
    if (this.locked) return;
    this._speed = s;
  }

  stepMinute(): number {
    if (!this._playing) this._simTs = Math.floor(this._simTs / 60000) * 60000 + 60000;
    return this._simTs;
  }

  tick(realElapsedMs: number): number {
    if (this._playing && realElapsedMs > 0) this._simTs += realElapsedMs * this._speed;
    return this._simTs;
  }
}
