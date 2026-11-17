import { useState } from 'react';
import { useStore } from './store';
import { send } from './wsClient';
import { HelpProvider } from './learn/HelpContext';
import { SetupKeys } from './screens/SetupKeys';
import { SessionSetup } from './screens/SessionSetup';
import { Trading } from './screens/Trading';

export function App() {
  const s = useStore();
  const [, setView] = useState<'setup' | 'history'>('setup');
  if (!s.status) {
    return <main className="p-10 text-muted">{s.connected ? 'Loading…' : 'Connecting to the local server…'}</main>;
  }
  if (!s.status.keysOk) return <SetupKeys />;
  const helpLevel = s.session?.config.helpLevel ?? 'learn';
  let screen;
  if (s.session?.status === 'active') screen = <Trading />;
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
