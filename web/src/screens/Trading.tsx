import { useStore } from '../store';
import { send } from '../wsClient';
import { useNow } from '../useNow';
import { useHelp } from '../learn/HelpContext';
import { Watchlist } from '../trading/Watchlist';
import { Chart } from '../trading/Chart';
import { QuotePanel } from '../trading/QuotePanel';
import { AccountBar } from '../trading/AccountBar';
import { Clock } from '../trading/Clock';
import { ReplayControls } from '../trading/ReplayControls';
import { OrderTicket } from '../trading/OrderTicket';
import { Positions } from '../trading/Positions';
import { Orders } from '../trading/Orders';
import { useTradingShortcuts } from '../trading/useTradingShortcuts';
import { workingOrders } from '../store';
import { useState } from 'react';
import { DEFAULT_WATCHLIST, type Side } from '../../../shared/types';

export function Trading() {
  const s = useStore();
  const now = useNow();
  const { learn } = useHelp();
  const session = s.session!;
  const cfg = session.config;
  const replay = cfg.dataSource === 'replay';
  const hideDate = cfg.helpLevel === 'challenge' && replay;
  const watchlist = s.status?.settings?.watchlist ?? DEFAULT_WATCHLIST;
  const selected = s.selected ?? watchlist[0];
  const select = (sym: string) => { s.select(sym); send({ type: 'select_symbol', symbol: sym }); };
  const orders = Object.values(s.orders);
  const ts = replay ? (s.clock?.simTs ?? now) : now;
  const phase = replay ? 'open' : (s.status?.market.phase ?? 'closed');
  const [focusRequest, setFocusRequest] = useState<{ side: Side; n: number }>();
  useTradingShortcuts({ send, symbol: selected, onFocusSide: (side) => setFocusRequest((f) => ({ side, n: (f?.n ?? 0) + 1 })) });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${learn ? 'bg-tutor text-tutor-ink' : 'bg-raised text-text'}`}>
            {learn ? 'Learn' : 'Challenge'}
          </span>
          <span className="text-[12px] text-muted">{replay ? 'Replay' : 'Live'}{session.replayDate ? ` of ${session.replayDate}` : ''}</span>
        </div>
        <Clock ts={ts} phase={phase} showDate={!hideDate} />
        {replay && (
          <ReplayControls playing={s.clock?.playing ?? false} speed={s.clock?.speed ?? 1} locked={cfg.helpLevel === 'challenge'}
            onAction={(action, speed) => send({ type: 'replay_control', action, speed })} />
        )}
        <div className="flex-1"><AccountBar account={s.account} rules={cfg.rules} startingCash={cfg.startingCash} live={!replay} dataStatus={s.status?.data ?? 'disconnected'} /></div>
        <button className="btn" onClick={() => send({ type: 'end_session' })}>End session</button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_320px] gap-2 p-2">
        <aside className="panel min-h-0 overflow-hidden" data-tour="watchlist">
          <Watchlist symbols={watchlist} prices={s.prices} candles={s.candles} selected={selected} onSelect={select}
            onChange={(symbols) => send({ type: 'set_watchlist', symbols })} />
        </aside>
        <section className="flex min-h-0 flex-col gap-2">
          <div className="panel"><QuotePanel symbol={selected} quote={s.prices[selected]?.quote} print={s.prices[selected]?.print} candles={s.candles[selected] ?? []} /></div>
          <div className="panel min-h-[280px] flex-1 overflow-hidden">
            <Chart symbol={selected} candles={s.candles[selected] ?? []} fills={s.fills} orders={orders} hideDate={hideDate} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="panel"><Positions positions={Object.values(s.account?.state.positions ?? {})} prices={s.prices} onSend={send} /></div>
            <div className="panel"><Orders orders={workingOrders(s.orders)} onSend={send} /></div>
          </div>
        </section>
        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <OrderTicket key={selected} symbol={selected} quote={s.prices[selected]?.quote} startingCash={cfg.startingCash}
            onSend={send} lastReject={s.lastReject} onDismissReject={s.clearReject} focusRequest={focusRequest} />
          <p className="px-1 text-[11px] text-muted">Keys: B buy · S sell · C close {selected} · Shift+X cancel all</p>
        </aside>
      </div>
    </div>
  );
}
