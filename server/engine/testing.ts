import type { PriceEvent } from '../../shared/types';

let autoTs = 1_000_000;
export const q = (symbol: string, bid: number, ask: number, ts = ++autoTs): PriceEvent => ({ kind: 'quote', quote: { symbol, bid, ask, ts } });
export const p = (symbol: string, price: number, ts = ++autoTs, size = 100): PriceEvent => ({ kind: 'print', print: { symbol, price, size, ts } });
export const seqIds = () => { let i = 0; return () => `id${++i}`; };
