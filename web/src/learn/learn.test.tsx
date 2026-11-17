import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GLOSSARY, type TermId } from './glossary';
import { Term } from './Term';
import { HelpProvider } from './HelpContext';
import { PreTrade } from './PreTrade';
import { Walkthrough } from './Walkthrough';
import { Warnings } from './Warnings';
import { DailyLimitDialog } from './DailyLimitDialog';

const quote = { symbol: 'AAPL', bid: 187.38, ask: 187.4, ts: 0 };
const req = { symbol: 'AAPL', side: 'buy' as const, qty: 20, type: 'market' as const, bracket: { stopLoss: 186, takeProfit: 190 } };

describe('glossary', () => {
  const required: TermId[] = ['bid', 'ask', 'spread', 'last', 'volume', 'candlestick', 'vwap', 'ema', 'marketOrder', 'limitOrder',
    'stopLoss', 'takeProfit', 'bracket', 'slippage', 'position', 'unrealizedPnl', 'realizedPnl', 'equity', 'buyingPower',
    'riskPerTrade', 'dailyLossLimit', 'winRate', 'avgWinLoss', 'dayTrading', 'pdt', 'marketHours', 'iex'];
  it('covers every required term with a non-empty term, definition and example', () => {
    for (const id of required) expect(GLOSSARY[id], id).toBeDefined();
    for (const [id, e] of Object.entries(GLOSSARY)) {
      expect(e.term.trim(), id).not.toBe('');
      expect(e.definition.trim(), id).not.toBe('');
      expect(e.example.trim(), id).not.toBe('');
      expect(e.example, `${id} example has a number`).toMatch(/\d/);
    }
  });
  it('never tells the user what to buy or sell', () => {
    for (const e of Object.values(GLOSSARY)) expect(`${e.definition} ${e.example}`).not.toMatch(/you should (buy|sell)/i);
  });
});

describe('<Term>', () => {
  it('in Learn renders a tooltip with the definition', () => {
    render(<HelpProvider helpLevel="learn"><Term id="spread">Spread</Term></HelpProvider>);
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.spread.definition);
  });
  it('in Challenge renders the text only, with no tooltip element', () => {
    const { container } = render(<HelpProvider helpLevel="challenge"><Term id="spread">Spread</Term></HelpProvider>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(container.innerHTML).toBe('Spread');
  });
});

describe('<PreTrade>', () => {
  it('shows the explanation in Learn', () => {
    render(<HelpProvider helpLevel="learn"><PreTrade req={req} quote={quote} startingCash={25000} /></HelpProvider>);
    expect(screen.getByText(/Buying 20 shares of AAPL at ~\$187.40 = \$3,748/)).toBeInTheDocument();
  });
  it('is absent in Challenge', () => {
    const { container } = render(<HelpProvider helpLevel="challenge"><PreTrade req={req} quote={quote} startingCash={25000} /></HelpProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('<Warnings>', () => {
  it('lists warnings in Learn and nothing in Challenge', () => {
    const w = [{ code: 'no_stop' as const, message: "This order has no stop-loss, so your possible loss isn't limited." }];
    const { rerender, container } = render(<HelpProvider helpLevel="learn"><Warnings warnings={w} /></HelpProvider>);
    expect(screen.getByText(w[0].message)).toBeInTheDocument();
    rerender(<HelpProvider helpLevel="challenge"><Warnings warnings={w} /></HelpProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('<Walkthrough>', () => {
  it('does not render in Challenge', () => {
    const { container } = render(<HelpProvider helpLevel="challenge"><Walkthrough done={false} onSend={() => {}} onDone={() => {}} /></HelpProvider>);
    expect(container).toBeEmptyDOMElement();
  });
  it('does not render once done', () => {
    const { container } = render(<HelpProvider helpLevel="learn"><Walkthrough done onSend={() => {}} onDone={() => {}} /></HelpProvider>);
    expect(container).toBeEmptyDOMElement();
  });
  it('walks 8 steps and "Skip" sets walkthroughDone', async () => {
    const onSend = vi.fn();
    const onDone = vi.fn();
    render(<HelpProvider helpLevel="learn"><Walkthrough done={false} onSend={onSend} onDone={onDone} /></HelpProvider>);
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'set_setting', key: 'walkthroughDone', value: true });
    expect(onDone).toHaveBeenCalled();
  });
});

describe('<DailyLimitDialog>', () => {
  it('offers a recorded override', async () => {
    const onSend = vi.fn();
    render(<HelpProvider helpLevel="learn"><DailyLimitDialog onSend={onSend} /></HelpProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Override and keep trading (this will be recorded)' }));
    expect(onSend).toHaveBeenCalledWith({ type: 'override_daily_limit' });
  });
});
