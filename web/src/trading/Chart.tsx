import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart, createSeriesMarkers, LineStyle,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type IPriceLine, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import { aggregateCandles } from '../../../shared/candles';
import { ema, vwap } from '../../../shared/indicators';
import { formatChartTime } from '../../../shared/market';
import type { Candle, Fill, Order } from '../../../shared/types';
import { Term } from '../learn/Term';

const COLORS = { up: '#3dbe8b', down: '#ef6074', text: '#8a97aa', rule: '#2a3546', vwap: '#c7a6ff', ema9: '#7fb2ff', ema20: '#f0b54a' };
const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export type Timeframe = 1 | 5 | 15;

interface Props {
  symbol: string; candles: Candle[]; fills: Fill[]; orders: Order[]; hideDate: boolean;
  height?: number; showControls?: boolean;
}

/** Candles + volume, 1m/5m/15m, VWAP and EMA 9/20 toggles, entry/exit markers, working stop/limit lines. */
export function Chart({ symbol, candles, fills, orders, hideDate, height = 360, showControls = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi; candle: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'>;
    vwap: ISeriesApi<'Line'>; ema9: ISeriesApi<'Line'>; ema20: ISeriesApi<'Line'>;
    markers: ISeriesMarkersPluginApi<Time>; lines: IPriceLine[];
  } | null>(null);
  const [tf, setTf] = useState<Timeframe>(1);
  const [showVwap, setShowVwap] = useState(true);
  const [showEma, setShowEma] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const fmt = (t: Time) => formatChartTime((t as number) * 1000, hideDate);
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: COLORS.text, fontFamily: 'Public Sans, sans-serif' },
      grid: { vertLines: { color: '#1f2836' }, horzLines: { color: '#1f2836' } },
      rightPriceScale: { borderColor: COLORS.rule },
      timeScale: { borderColor: COLORS.rule, timeVisible: true, secondsVisible: false, tickMarkFormatter: (t: Time) => fmt(t).split(' ').at(-1)! },
      localization: { timeFormatter: fmt },
      crosshair: { mode: 0 },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const line = (color: string) => chart.addSeries(LineSeries, { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    api.current = {
      chart, candle, volume, vwap: line(COLORS.vwap), ema9: line(COLORS.ema9), ema20: line(COLORS.ema20),
      markers: createSeriesMarkers(candle, []), lines: [],
    };
    return () => { chart.remove(); api.current = null; };
  }, [hideDate]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const data = tf === 1 ? candles : aggregateCandles(candles, tf);
    a.candle.setData(data.map((c) => ({ time: sec(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
    a.volume.setData(data.map((c) => ({ time: sec(c.t), value: c.v, color: c.c >= c.o ? '#3dbe8b55' : '#ef607455' })));
    const v = vwap(data);
    a.vwap.setData(showVwap ? data.map((c, i) => ({ time: sec(c.t), value: v[i] })) : []);
    const closes = data.map((c) => c.c);
    const toLine = (vals: (number | undefined)[]) => data.flatMap((c, i) => (vals[i] === undefined ? [] : [{ time: sec(c.t), value: vals[i]! }]));
    a.ema9.setData(showEma ? toLine(ema(closes, 9)) : []);
    a.ema20.setData(showEma ? toLine(ema(closes, 20)) : []);

    const bucket = tf * 60;
    const markers: SeriesMarker<Time>[] = fills.filter((f) => f.symbol === symbol).map((f) => ({
      time: (Math.floor(f.ts / 1000 / bucket) * bucket) as UTCTimestamp,
      position: f.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: f.side === 'buy' ? COLORS.up : COLORS.down,
      shape: f.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: `${f.side === 'buy' ? 'Buy' : 'Sell'} ${f.qty} @ ${f.price.toFixed(2)}`,
    }));
    markers.sort((x, y) => (x.time as number) - (y.time as number));
    a.markers.setMarkers(markers);

    for (const l of a.lines) a.candle.removePriceLine(l);
    a.lines = orders.filter((o) => o.symbol === symbol && o.status === 'working').flatMap((o) => {
      const price = o.type === 'stop' ? o.stopPrice : o.limitPrice;
      if (!price) return [];
      const isStop = o.type === 'stop';
      return [a.candle.createPriceLine({
        price, color: isStop ? COLORS.down : o.side === 'sell' ? COLORS.up : COLORS.ema9, lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true,
        title: isStop ? 'Stop' : o.side === 'sell' ? 'Target' : 'Limit buy',
      })];
    });
  }, [candles, fills, orders, symbol, tf, showVwap, showEma, hideDate]);

  return (
    <div className="flex h-full flex-col">
      {showControls && (
        <div className="flex items-center gap-3 border-b border-rule px-2 py-1 text-[12px]">
          <span className="font-semibold text-text text-[14px]">{symbol}</span>
          <div role="group" aria-label="Timeframe" className="flex">
            {([1, 5, 15] as Timeframe[]).map((m) => (
              <button key={m} aria-pressed={tf === m} className={`px-2 py-0.5 rounded ${tf === m ? 'bg-raised text-text' : 'text-muted'}`} onClick={() => setTf(m)}>{m}m</button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} /><Term id="vwap">VWAP</Term></label>
          <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={showEma} onChange={(e) => setShowEma(e.target.checked)} /><Term id="ema">EMA 9/20</Term></label>
          <span className="ml-auto text-muted"><Term id="candlestick">Candles</Term> show each {tf}-minute period</span>
        </div>
      )}
      <div ref={el} className="min-h-0 flex-1" style={{ height: showControls ? undefined : height }} />
    </div>
  );
}
