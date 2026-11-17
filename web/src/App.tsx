import { useState } from 'react';
import { useStore } from './store';
import { send } from './wsClient';
import { HelpProvider } from './learn/HelpContext';
import { SetupKeys } from './screens/SetupKeys';
import { SessionSetup } from './screens/SessionSetup';
import { Trading } from './screens/Trading';
import { Review } from './screens/Review';
import { History } from './screens/History';

export function App() {
  const s = useStore();
  const [view, setView] = useState<'setup' | 'history'>('setup');
  if (!s.status) {
    return <main className="p-10 text-muted">{s.connected ? 'Loading…' : 'Connecting to the local server…'}</main>;
  }
  if (!s.status.keysOk) return <SetupKeys />;
  const helpLevel = s.session?.config.helpLevel ?? 'learn';
  let screen;
  if (s.session?.status === 'active' && !s.review) screen = <Trading />;
  else if (s.review) screen = <Review review={s.review} candles={s.candles} onSend={send} onNewSession={s.clearReview} />;
  else if (view === 'history') screen = <History onBack={() => setView('setup')} />;
  else screen = (
    <SessionSetup market={s.status.market} settings={s.status.settings!} now={Date.now()}
      onStart={(config) => send({ type: 'start_session', config })} onHistory={() => setView('history')} />
  );
  return (
    <HelpProvider helpLevel={helpLevel}>
      {screen}
      {s.lastError && (
        <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 panel flex items-center gap-3 px-4 py-2">
          <span>{s.lastError.message}</span>
          <button className="text-muted" aria-label="Dismiss" onClick={s.clearError}>×</button>
        </div>
      )}
    </HelpProvider>
  );
}
