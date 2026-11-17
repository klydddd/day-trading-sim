import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clock } from './Clock';
import { ReplayControls } from './ReplayControls';
import { AccountBar } from './AccountBar';
import { DEFAULT_RULES } from '../../../shared/types';

const TS = Date.UTC(2026, 10, 13, 15, 42, 15); // Fri Nov 13 2026 10:42:15 ET

describe('Clock', () => {
  it('shows ET time and phase', () => {
    render(<Clock ts={TS} phase="open" showDate={false} />);
    expect(screen.getByText('10:42:15 ET · Market open')).toBeInTheDocument();
  });
  it('in Challenge + Replay renders no date', () => {
    const { container } = render(<Clock ts={TS} phase="open" showDate={false} />);
    expect(container.textContent).not.toMatch(/Nov|13|2026|Fri/);
  });
  it('shows the date otherwise', () => {
    const { container } = render(<Clock ts={TS} phase="open" showDate />);
    expect(container.textContent).toContain('Fri Nov 13');
  });
});

describe('ReplayControls', () => {
  it('in Challenge the speed buttons are disabled with an explanation', () => {
    render(<ReplayControls playing={false} speed={1} locked onAction={() => {}} />);
    for (const s of ['1×', '2×', '5×', '10×']) {
      const b = screen.getByRole('button', { name: s });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Speed is locked in Challenge');
    }
  });
  it('"+1 min" is disabled while playing and enabled while paused', () => {
    const { rerender } = render(<ReplayControls playing speed={1} locked={false} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: '+1 min' })).toBeDisabled();
    rerender(<ReplayControls playing={false} speed={1} locked={false} onAction={() => {}} />);
    expect(screen.getByRole('button', { name: '+1 min' })).toBeEnabled();
  });
  it('has no back button and sends play/speed actions', async () => {
    const onAction = vi.fn();
    render(<ReplayControls playing={false} speed={1} locked={false} onAction={onAction} />);
    expect(screen.queryByRole('button', { name: /back|rewind/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await userEvent.click(screen.getByRole('button', { name: '5×' }));
    expect(onAction.mock.calls).toEqual([['play'], ['speed', 5]]);
  });
});

describe('AccountBar', () => {
  const account = { type: 'account' as const, state: { cash: 20000, positions: {}, orders: [], realizedPnl: -100 }, equity: 24900, sessionPnl: -100, buyingPower: 20000 };
  it('shows the disconnected banner during a live session when data is reconnecting', () => {
    render(<AccountBar account={account} rules={DEFAULT_RULES} startingCash={25000} live dataStatus="reconnecting" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Live data disconnected, reconnecting… Prices shown may be out of date.');
  });
  it('shows no banner when connected, and the distance to the daily limit', () => {
    render(<AccountBar account={account} rules={DEFAULT_RULES} startingCash={25000} live dataStatus="connected" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/\$650 left before daily limit/)).toBeInTheDocument();
  });
});

import { QuotePanel } from './QuotePanel';
describe('QuotePanel', () => {
  it('shows a tight spread with enough precision to not read as zero', () => {
    render(<QuotePanel symbol="SPY" quote={{ symbol: 'SPY', bid: 590.7, ask: 590.72, ts: 0 }} candles={[]} />);
    expect(screen.getByText('$0.02 (0.003%)')).toBeInTheDocument();
  });
});
