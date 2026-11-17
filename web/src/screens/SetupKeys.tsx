export function SetupKeys() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-2xl font-bold">Connect free market data</h1>
      <p className="mt-2 text-muted">
        The simulator uses real US stock prices from Alpaca's free data plan. It never trades real money: the keys are only used to read prices.
      </p>
      <ol className="mt-8 space-y-5 list-decimal pl-5">
        <li>
          Create a free Alpaca account at{' '}
          <a className="underline" href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer">app.alpaca.markets/signup</a>.
          No deposit is needed.
        </li>
        <li>In the Alpaca dashboard, switch to <strong>Paper Trading</strong>, find <strong>API Keys</strong>, and generate a key pair.</li>
        <li>
          In this project folder, copy <code>.env.example</code> to <code>.env</code> and paste both values:
          <pre className="panel mt-2 p-3 text-[13px]">{`ALPACA_KEY_ID=your key id\nALPACA_SECRET_KEY=your secret key`}</pre>
        </li>
        <li>Stop the app (Ctrl+C) and run <code>npm run dev</code> again, then reload this page.</li>
      </ol>
      <p className="mt-8 text-muted text-[13px]">The keys stay on this computer, in the local server. They are never sent to the browser.</p>
    </main>
  );
}
