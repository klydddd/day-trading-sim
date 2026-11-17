import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderTicket, dollarsToShares } from './OrderTicket';
import { useTradingShortcuts } from './useTradingShortcuts';
import type { ClientMessage } from '../../../shared/protocol';

const quote = { symbol: 'AAPL', bid: 187.38, ask: 187.4, ts: 0 };

describe('dollarsToShares', () => {
  it('floors to whole shares at the ask', () => {
    expect(dollarsToShares(1000, 187.4)).toBe(5);
    expect(dollarsToShares(100, 0)).toBe(0);
  });
});

describe('OrderTicket', () => {
  it('a buy bracket with the stop at or above the ask shows an error and does not send', async () => {
    const onSend = vi.fn();
    render(<OrderTicket symbol="AAPL" quote={quote} startingCash={25000} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText('Shares'), '10');
    await userEvent.type(screen.getByLabelText('Stop-loss'), '187.40');
    expect(screen.getByText('The stop-loss must be below the entry price ($187.40).')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Buy 10 AAPL/ }));
    expect(onSend.mock.calls.map((c) => (c[0] as ClientMessage).type)).not.toContain('submit_order');
  });

  it('a valid bracketed buy submits submit_order', async () => {
    const onSend = vi.fn();
    render(<OrderTicket symbol="AAPL" quote={quote} startingCash={25000} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText('Shares'), '20');
    await userEvent.type(screen.getByLabelText('Stop-loss'), '186');
    await userEvent.type(screen.getByLabelText('Take-profit'), '190');
    await userEvent.click(screen.getByRole('button', { name: /^Buy 20 AAPL/ }));
    expect(onSend).toHaveBeenCalledWith({ type: 'submit_order', req: { symbol: 'AAPL', side: 'buy', qty: 20, type: 'market', bracket: { stopLoss: 186, takeProfit: 190 } } });
  });

  it('dollar mode converts the amount to shares at the ask', async () => {
    const onSend = vi.fn();
    render(<OrderTicket symbol="AAPL" quote={quote} startingCash={25000} onSend={onSend} />);
    await userEvent.click(screen.getByRole('radio', { name: '$ amount' }));
    await userEvent.type(screen.getByLabelText('Dollar amount'), '1000');
    expect(screen.getByText('= 5 shares')).toBeInTheDocument();
  });

  it('shows a rejection in plain words', () => {
    render(<OrderTicket symbol="AAPL" quote={quote} startingCash={25000} onSend={() => {}}
      lastReject={{ id: 'x', symbol: 'AAPL', side: 'buy', qty: 1, type: 'market', status: 'rejected', rejectReason: 'stale_data', createdAt: 0 }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/out of date/);
  });
});

function ShortcutHarness({ send, onSide }: { send: (m: ClientMessage) => void; onSide: (s: 'buy' | 'sell') => void }) {
  useTradingShortcuts({ send, symbol: 'AAPL', onFocusSide: onSide });
  return <input aria-label="Shares" />;
}

describe('useTradingShortcuts', () => {
  it('B focuses Buy, but not while typing in an input', async () => {
    const onSide = vi.fn();
    render(<ShortcutHarness send={() => {}} onSide={onSide} />);
    await userEvent.type(screen.getByLabelText('Shares'), 'b');
    expect(onSide).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(onSide).toHaveBeenCalledWith('buy');
    fireEvent.keyDown(document.body, { key: 's' });
    expect(onSide).toHaveBeenLastCalledWith('sell');
  });
  it('Shift+X sends cancel_all and C closes the selected position', () => {
    const send = vi.fn();
    render(<ShortcutHarness send={send} onSide={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'X', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(send.mock.calls).toEqual([[{ type: 'cancel_all' }], [{ type: 'close_position', symbol: 'AAPL' }]]);
  });
});
