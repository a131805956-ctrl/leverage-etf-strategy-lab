import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { BacktestResult } from '../core/types';

export interface WorkbenchChart {
  render(result: BacktestResult): void;
  fit(): void;
  setRange(years: 1 | 3 | 'all'): void;
  setLogarithmic(enabled: boolean): void;
  destroy(): void;
}

const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createWorkbenchChart(
  host: HTMLElement,
  tooltip: HTMLElement,
): WorkbenchChart {
  const chart: IChartApi = createChart(host, {
    width: host.clientWidth,
    height: host.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: css('--paper') },
      textColor: css('--ink-2'),
      fontFamily: css('--font-data'),
      fontSize: 10,
    },
    grid: {
      vertLines: { color: css('--line'), style: LineStyle.Dotted },
      horzLines: { color: css('--line'), style: LineStyle.Dotted },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: css('--line') },
    timeScale: {
      borderColor: css('--line'),
      timeVisible: false,
      rightOffset: 2,
      barSpacing: 5,
    },
  });
  const strategy = chart.addLineSeries({
    color: css('--teal'),
    lineWidth: 3,
    title: '策略',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const prototype = chart.addLineSeries({
    color: css('--blue'),
    lineWidth: 2,
    title: '原型 ETF',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const leveraged = chart.addLineSeries({
    color: css('--orange'),
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    title: '槓桿 ETF',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  let current: BacktestResult | undefined;
  const series: Array<ISeriesApi<'Line'>> = [strategy, prototype, leveraged];

  chart.subscribeCrosshairMove((parameter) => {
    if (!parameter.time || !current) {
      tooltip.style.display = 'none';
      return;
    }
    const time = parameter.time;
    const date =
      typeof time === 'string'
        ? time
        : typeof time === 'number'
          ? new Date(time * 1000).toISOString().slice(0, 10)
          : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
    const point = current.points.find((item) => item.date === date);
    if (!point) return;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min((parameter.point?.x ?? 0) + 18, host.clientWidth - 180)}px`;
    tooltip.style.top = `${Math.max(12, (parameter.point?.y ?? 0) - 58)}px`;
    tooltip.innerHTML = [
      `<strong>${point.date}</strong>`,
      `策略: ${point.value.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`,
      `曝險: ${point.nominalExposure.toFixed(1)}%`,
      `回撤: -${point.drawdown.toFixed(1)}%`,
      `階段: ${point.regime}`,
    ].join('<br>');
  });

  const observer = new ResizeObserver(() => {
    chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
  });
  observer.observe(host);

  return {
    render(result) {
      current = result;
      const start = result.initialCapital;
      const toData = (key: 'value' | 'benchmarkPrototype' | 'benchmarkLeveraged'): LineData<Time>[] =>
        result.points.map((point) => ({
          time: point.date,
          value: (point[key] / start) * 100,
        }));
      strategy.setData(toData('value'));
      prototype.setData(toData('benchmarkPrototype'));
      leveraged.setData(toData('benchmarkLeveraged'));
      const important = result.trades
        .slice(1)
        .filter(
          (trade) =>
            trade.reason === 'DRAWDOWN' ||
            trade.reason === 'RECOVERY' ||
            trade.reason === 'DIVIDEND_REINVEST',
        );
      const stride = Math.max(1, Math.ceil(important.length / 70));
      strategy.setMarkers(
        important.filter((_, index) => index % stride === 0).map((trade, index) => ({
          time: trade.date,
          position: trade.targetLeveragedWeight >= 70 ? 'belowBar' : 'aboveBar',
          color: trade.targetLeveragedWeight >= 70 ? css('--orange') : css('--teal'),
          shape: trade.targetLeveragedWeight >= 70 ? 'arrowUp' : 'arrowDown',
          text: index % 6 === 0 ? `${trade.targetLeveragedWeight.toFixed(0)}%` : '',
        })),
      );
      chart.timeScale().fitContent();
    },
    fit() {
      chart.timeScale().fitContent();
    },
    setRange(years) {
      if (!current || years === 'all') {
        chart.timeScale().fitContent();
        return;
      }
      const last = current.points.at(-1)?.date;
      if (!last) return;
      const from = new Date(`${last}T00:00:00Z`);
      from.setUTCFullYear(from.getUTCFullYear() - years);
      chart.timeScale().setVisibleRange({
        from: from.toISOString().slice(0, 10),
        to: last,
      });
    },
    setLogarithmic(enabled) {
      for (const item of series) {
        item.priceScale().applyOptions({ mode: enabled ? 1 : 0 });
      }
    },
    destroy() {
      observer.disconnect();
      chart.remove();
    },
  };
}
