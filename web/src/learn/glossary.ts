/** Plain-English, beginner-level definitions. One sentence each, plus an example with numbers. Never advice. */
export const GLOSSARY = {
  // Quotes and charts
  bid: { term: 'Bid', definition: 'The highest price a buyer is offering right now; a market sell fills here.', example: 'Bid $187.38 means selling 10 shares now gets you about $1,873.80.' },
  ask: { term: 'Ask', definition: 'The lowest price a seller will accept right now; a market buy fills here.', example: 'Ask $187.40 means buying 10 shares now costs about $1,874.' },
  spread: { term: 'Spread', definition: 'The gap between the bid and the ask; you pay it every time you buy and then sell.', example: 'Bid $187.38, ask $187.40: the spread is 2¢, so 100 shares start $2 down.' },
  last: { term: 'Last price', definition: 'The price of the most recent trade between other people.', example: 'Last $187.39 means someone just traded at $187.39; your own fill depends on the bid or ask.' },
  volume: { term: 'Volume', definition: 'How many shares changed hands in a period.', example: 'A 1-minute candle with volume 12,000 means 12,000 shares traded in that minute.' },
  candlestick: { term: 'Candlestick', definition: 'A bar showing a period’s open, high, low and close price; green if it closed higher than it opened, red if lower.', example: 'Open $10, high $12, low $9, close $11: a green candle with wicks from $9 to $12.' },
  vwap: { term: 'VWAP', definition: 'Volume-weighted average price: the average price paid today, counting busy minutes more.', example: 'If 100 shares traded at $10 and 300 at $20, VWAP is $17.50.' },
  ema: { term: 'EMA', definition: 'Exponential moving average: an average of recent closing prices that leans toward the newest ones.', example: 'A 9-period EMA on a 1-minute chart averages roughly the last 9 minutes of closes.' },
  // Orders
  marketOrder: { term: 'Market order', definition: 'An order to trade right now at the best available price: the ask when buying, the bid when selling.', example: 'A market buy of 5 shares with the ask at $50.02 fills at $50.02.' },
  limitOrder: { term: 'Limit order', definition: 'An order that only fills at your price or better, so it may not fill at all.', example: 'A buy limit at $50.00 waits; here it fills only when the price trades below $50.00.' },
  stopLoss: { term: 'Stop-loss', definition: 'An order that sells your shares once the price falls to a level you choose, to cap your loss.', example: 'Bought at $50 with a stop at $49: if price hits $49 you sell, losing about $1 per share.' },
  takeProfit: { term: 'Take-profit', definition: 'A sell limit order above your entry that locks in a gain if the price gets there.', example: 'Bought at $50 with a take-profit at $52: if it trades above $52 you sell and keep about $2 per share.' },
  bracket: { term: 'Bracket order', definition: 'A buy with a stop-loss and a take-profit attached; when one of them fills, the other is cancelled.', example: 'Buy at $50, stop $49, target $52: you exit at whichever level is reached first.' },
  slippage: { term: 'Slippage', definition: 'The difference between the price you expected and the price you actually got.', example: 'Stop at $49.00 but the price jumps to $47.95: you fill at $47.95, $1.05 of slippage per share.' },
  // Account
  position: { term: 'Position', definition: 'The shares of a stock you currently own.', example: 'After buying 20 AAPL you have a 20-share position until you sell them.' },
  unrealizedPnl: { term: 'Unrealized P&L', definition: 'Profit or loss on shares you still hold, valued at the current bid; it changes until you sell.', example: 'Own 10 shares bought at $50, bid now $51: unrealized P&L is +$10.' },
  realizedPnl: { term: 'Realized P&L', definition: 'Profit or loss you have locked in by selling.', example: 'Bought 10 at $50, sold at $51: realized P&L is +$10.' },
  equity: { term: 'Equity', definition: 'What your account is worth right now: cash plus your shares at the current bid.', example: '$20,000 cash plus 100 shares at a $50 bid = $25,000 equity.' },
  cash: { term: 'Cash', definition: 'Money in the account that is not in shares.', example: 'Start with $25,000, buy $3,748 of stock: $21,252 cash left.' },
  buyingPower: { term: 'Buying power', definition: 'How much you can spend on new buys: your cash minus what working buy orders have reserved.', example: '$10,000 cash with a working buy of 50 shares at $40 leaves $8,000 buying power.' },
  // Rules and stats
  riskPerTrade: { term: 'Risk per trade', definition: 'How much you would lose if your stop-loss is hit, decided before you enter.', example: '20 shares bought at $187.40 with a stop at $186 risks $28.' },
  dailyLossLimit: { term: 'Daily loss limit', definition: 'The most you allow yourself to lose in one day; after that you stop trading.', example: 'A 3% limit on $25,000 means stopping once you are down $750 for the day.' },
  winRate: { term: 'Win rate', definition: 'The share of your trades that made money.', example: '6 winners out of 10 trades is a 60% win rate.' },
  avgWinLoss: { term: 'Average win vs. loss', definition: 'Your typical winning trade compared with your typical losing trade; together with win rate it decides if you make money.', example: 'Average win $50, average loss $100, 6 wins in 10 trades: +$300 − $400 = −$100.' },
  // Market
  dayTrading: { term: 'Day trading', definition: 'Buying and selling within the same day, ending the day with no open positions.', example: 'Buy 10 SPY at 10:05am and sell them at 11:20am the same day.' },
  pdt: { term: 'Pattern day trader rule', definition: 'A US rule: margin accounts that make 4+ day trades in 5 business days must keep at least $25,000.', example: 'With $20,000 you would be limited to 3 day trades per 5 days; with $25,000 you are not.' },
  marketHours: { term: 'Market hours', definition: 'US stocks trade regularly from 9:30am to 4:00pm Eastern time, closing at 1:00pm on some half-days.', example: 'The day after Thanksgiving the market usually closes at 1:00pm ET.' },
  iex: { term: 'IEX', definition: 'One US stock exchange; the free live data here comes from it, so volume shows only its share of trading.', example: 'If 1,000,000 shares trade market-wide, IEX volume might show about 30,000.' },
  replay: { term: 'Replay', definition: 'A real past trading day played back second by second, using that day’s real 1-minute prices.', example: 'Replaying a day at 5× speed shows 5 minutes of market in 1 minute.' },
} as const satisfies Record<string, { term: string; definition: string; example: string }>;

export type TermId = keyof typeof GLOSSARY;
