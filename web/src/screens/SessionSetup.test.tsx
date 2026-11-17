import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSetup } from './SessionSetup';
import { DEFAULT_RULES } from '../../../shared/types';

const settings = { rules: DEFAULT_RULES, watchlist: ['SPY'], feePerShare: 0, walkthroughDone: false };
const closed = { phase: 'closed' as const, isOpen: false, nextOpen: Date.UTC(2026, 10, 16, 14, 30), nextClose: 0 };
const NOW = Date.UTC(2026, 10, 14, 17); // Saturday

describe('SessionSetup', () => {
  it('with the market closed, Live is disabled, the status is shown, and "Start a Replay instead" switches to Replay', async () => {
    const onStart = vi.fn();
    render(<SessionSetup market={closed} settings={settings} now={NOW} onStart={onStart} onHistory={() => {}} initialDataSource="live" />);
    expect(screen.getByRole('radio', { name: /live/i })).toBeDisabled();
    expect(screen.getByText('Market closed, opens Mon 9:30am ET')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a Replay instead' }));
    expect(screen.getByRole('radio', { name: /replay/i })).toBeChecked();
    expect(screen.getByLabelText(/replay date/i)).toBeInTheDocument();
  });

  it('in Challenge the date picker is hidden and the random-day text is shown', async () => {
    render(<SessionSetup market={closed} settings={settings} now={NOW} onStart={() => {}} onHistory={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: /challenge/i }));
    expect(screen.queryByLabelText(/replay date/i)).not.toBeInTheDocument();
    expect(screen.getByText("A random past trading day will be picked. You'll see which one at the end.")).toBeInTheDocument();
    expect(screen.getByLabelText(/profit target/i)).toBeInTheDocument();
  });

  it('starts a session with the default balance, rules and a past replay date', async () => {
    const onStart = vi.fn();
    render(<SessionSetup market={closed} settings={settings} now={NOW} onStart={onStart} onHistory={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      dataSource: 'replay', helpLevel: 'learn', startingCash: 25000, rules: DEFAULT_RULES, replayDate: '2026-11-13', replayStartTime: '09:30', feePerShare: 0,
    }));
  });
});
