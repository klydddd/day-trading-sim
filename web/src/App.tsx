import { useState } from 'react';
import { useStore } from './store';
import { send } from './wsClient';
import { HelpProvider } from './learn/HelpContext';
import { SetupKeys } from './screens/SetupKeys';
import { SessionSetup } from './screens/SessionSetup';

export function App() {
  const s = useStore();
  const [, setView] = useState<'setup' | 'history'>('setup');
  if (!s.status) {
    return <main className="p-10 text-muted">{s.connected ? 'Loading…' : 'Connecting to the local server…'}</main>;
  }
  if (!s.status.keysOk) return <SetupKeys />;
  const helpLevel = s.session?.config.helpLevel ?? 'learn';
  return (
    <HelpProvider helpLevel={helpLevel}>
      <SessionSetup market={s.status.market} settings={s.status.settings!} now={Date.now()}
        onStart={(config) => send({ type: 'start_session', config })} onHistory={() => setView('history')} />
    </HelpProvider>
  );
}
