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
import type {
  BacktestResult,
  DailyPoint,
  IsoDate,
  TradeRecord,
} from '../core/types';

/**
 * Extra event data is intentionally UI-owned. Core/backtest can add richer
 * fields later without making this chart renderer depend on that shape.
 */
export interface ChartEventStage {
  date: IsoDate;
  trigger?: string;
  reason?: string;
  capital?: number;
  value?: number;
  prototypeShares?: number;
  leveragedShares?: number;
  prototypeValue?: number;
  leveragedValue?: number;
  prototypeWeight?: number;
  leveragedWeight?: number;
  nominalExposure?: number;
  targetLeveragedWeight?: number;
}

export interface ChartEvent {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
  peakDate?: IsoDate;
  startIndex?: number;
  endIndex?: number;
  title?: string;
  stages?: ChartEventStage[];
  /** Core ExposureEvent names, kept here so app modal code can stay typed. */
  addTrades?: TradeRecord[];
  reductionTrades?: TradeRecord[];
  adds?: ChartEventStage[];
  reductions?: ChartEventStage[];
}

export interface ExposureRailSegment {
  date: IsoDate;
  exposure: number;
  color: string;
}

export interface ChartRenderOptions {
  events?: ChartEvent[];
  onEventClick?: (event: ChartEvent) => void;
}

export interface WorkbenchChart {
  render(result: BacktestResult, options?: ChartRenderOptions): void;
  setEvents(events: ChartEvent[], onEventClick?: (event: ChartEvent) => void): void;
  fit(): void;
  setRange(years: 1 | 3 | 'all'): void;
  setLogarithmic(enabled: boolean): void;
  destroy(): void;
}

/** An episode is closed only after the first reduction trade. */
export function isClosedExposureEvent(event: ChartEvent): boolean {
  return (
    (event.reductionTrades?.length ?? 0) > 0 ||
    (event.reductions?.length ?? 0) > 0 ||
    (event.stages?.some((stage) =>
      ['RECOVERY', 'REDUCTION', 'DELEVERAGE'].includes(stage.trigger ?? stage.reason ?? ''),
    ) ?? false)
  );
}

const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const money = (value: number): string =>
  value.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

const price = (value: number): string =>
  value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const percent = (value: number, digits = 1): string => `${value.toFixed(digits)}%`;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[
        character
      ] ?? character,
  );

/** Pure helper used both by the chart and its non-DOM tests. */
export function buildExposureRailSegments(
  points: DailyPoint[],
  maxSegments = 120,
): ExposureRailSegment[] {
  if (points.length === 0) return [];
  const limit = Math.max(1, Math.floor(maxSegments));
  const indices =
    points.length <= limit
      ? points.map((_, index) => index)
      : Array.from({ length: limit }, (_, index) =>
          Math.round((index * (points.length - 1)) / (limit - 1)),
        );
  return indices.map((index) => {
    const point = points[index] ?? points.at(-1)!;
    const ratio = Math.max(0, Math.min(1, (point.nominalExposure - 100) / 100));
    const hue = 170 - ratio * 145;
    return {
      date: point.date,
      exposure: point.nominalExposure,
      color: `hsl(${hue} 62% 48%)`,
    };
  });
}

/** Keep a tooltip inside the visible plot; useful for both mouse and touch. */
export function clampTooltipPosition(
  left: number,
  top: number,
  hostWidth: number,
  hostHeight: number,
  tooltipWidth: number,
  tooltipHeight: number,
  margin = 10,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, hostWidth - tooltipWidth - margin);
  const maxTop = Math.max(margin, hostHeight - tooltipHeight - margin);
  return {
    left: Math.round(Math.min(Math.max(left, margin), maxLeft)),
    top: Math.round(Math.min(Math.max(top, margin), maxTop)),
  };
}

/**
 * Keep all changing state in the hover card. This deliberately includes
 * both human-facing Chinese and stable English labels for AI/export users.
 */
export function formatChartPointTooltip(point: DailyPoint): string {
  const rich = point as DailyPoint & {
    prototypeShares?: number;
    leveragedShares?: number;
    prototypePrice?: number;
    leveragedPrice?: number;
    targetLeveragedWeight?: number;
    runningHigh?: number;
    trough?: number;
    reboundPct?: number;
    distanceToHighPct?: number;
    prototypeReboundPct?: number;
    leveragedReboundPct?: number;
    activeRule?: string;
    activeRuleKey?: string;
  };
  const shares = (value: number | undefined): string =>
    value === undefined ? '—' : value.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
  return [
    `<div class="chart-tooltip-title">${escapeHtml(point.date)}</div>`,
    `<div><span>現值 / Net value</span><b>${money(point.value)}</b></div>`,
    `<div><span>名目曝險 / Nominal exposure</span><b>${percent(point.nominalExposure)}</b></div>`,
    `<div><span>原型倉位 / Prototype weight</span><b>${percent(point.prototypeWeight)}</b></div>`,
    `<div><span>槓桿倉位 / Leveraged weight</span><b>${percent(point.leveragedWeight)}</b></div>`,
    `<div><span>目標槓桿 / Target leverage</span><b>${percent(point.targetLeveragedWeight)}</b></div>`,
    `<div><span>原型市值 / Prototype value</span><b>${money(point.prototypeValue)}</b></div>`,
    `<div><span>槓桿市值 / Leveraged value</span><b>${money(point.leveragedValue)}</b></div>`,
    `<div><span>現金 / Cash</span><b>${money(point.cash)}</b></div>`,
    `<div><span>下跌幅度 / Drawdown</span><b>${percent(point.drawdown)}</b></div>`,
    `<div><span>狀態 / Regime</span><b>${escapeHtml(point.regime)}</b></div>`,
    `<div><span>持有股數 / Shares</span><b>原型 ${shares(rich.prototypeShares)} · 槓桿 ${shares(rich.leveragedShares)}</b></div>`,
    ...(rich.prototypePrice === undefined
      ? []
      : [`<div><span>原型價格 / Prototype price</span><b>${price(rich.prototypePrice)}</b></div>`]),
    ...(rich.leveragedPrice === undefined
      ? []
      : [`<div><span>槓桿價格 / Leveraged price</span><b>${price(rich.leveragedPrice)}</b></div>`]),
    ...(rich.runningHigh === undefined
      ? []
      : [`<div><span>歷史高點 / Running high</span><b>${money(rich.runningHigh)}</b></div>`]),
    ...(rich.trough === undefined
      ? []
      : [`<div><span>谷底 / Trough</span><b>${money(rich.trough)}</b></div>`]),
    ...(rich.distanceToHighPct === undefined
      ? []
      : [`<div><span>距高點 / Distance to high</span><b>${percent(rich.distanceToHighPct)}</b></div>`]),
    ...(rich.reboundPct === undefined
      ? []
      : [`<div><span>反彈 / Rebound</span><b>${percent(rich.reboundPct)}</b></div>`]),
    ...(rich.prototypeReboundPct === undefined
      ? []
      : [`<div><span>原型反彈 / Prototype rebound</span><b>${percent(rich.prototypeReboundPct)}</b></div>`]),
    ...(rich.leveragedReboundPct === undefined
      ? []
      : [`<div><span>槓桿反彈 / Leveraged rebound</span><b>${percent(rich.leveragedReboundPct)}</b></div>`]),
    ...(rich.activeRule === undefined && rich.activeRuleKey === undefined
      ? []
      : [`<div><span>規則 / Active rule</span><b>${escapeHtml(rich.activeRule ?? rich.activeRuleKey ?? '')}</b></div>`]),
  ].join('');
}

const asDate = (time: Time): string => {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
};

const richerEvents = (result: BacktestResult): ChartEvent[] => {
  const enriched = result as BacktestResult & {
    exposureEvents?: unknown;
    events?: unknown;
  };
  const value = enriched.exposureEvents ?? enriched.events;
  return Array.isArray(value) ? (value as ChartEvent[]) : [];
};

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
      // This is Lightweight Charts, not a TradingView widget. Never render TV attribution.
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: css('--line'), style: LineStyle.Dotted },
      horzLines: { color: css('--line'), style: LineStyle.Dotted },
    },
    crosshair: { mode: CrosshairMode.Normal },
    // Let the document own vertical wheel/touch scrolling. Chart zoom and
    // horizontal panning remain available through the range buttons so a
    // pointer over the plot never traps the page at the chart boundary.
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: false,
      horzTouchDrag: false,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: false,
      pinch: false,
      axisPressedMouseMove: { time: false, price: false },
      axisDoubleClickReset: { time: true, price: true },
    },
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
    title: '策略 Strategy',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const prototype = chart.addLineSeries({
    color: css('--blue'),
    lineWidth: 2,
    title: '原型 ETF Prototype',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const leveraged = chart.addLineSeries({
    color: css('--orange'),
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    title: '槓桿 ETF Leveraged',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const series: Array<ISeriesApi<'Line'>> = [strategy, prototype, leveraged];
  const rail = document.createElement('div');
  rail.className = 'chart-exposure-overlay';
  rail.setAttribute('aria-label', '名目曝險軌道 Nominal exposure rail');
  const eventLayer = document.createElement('div');
  eventLayer.className = 'chart-event-layer';
  host.append(rail, eventLayer);

  let current: BacktestResult | undefined;
  let currentEvents: ChartEvent[] = [];
  let eventClick: ((event: ChartEvent) => void) | undefined;
  let frame = 0;

  const scheduleOverlay = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderOverlay();
    });
  };

  const coordinate = (date: IsoDate): number | null =>
    chart.timeScale().timeToCoordinate(date);

  function renderOverlay(): void {
    if (!current) return;
    // Lightweight Charts reserves the right price-axis gutter. Keep the DOM
    // overlay exactly as wide as the time-scale plot instead of stretching
    // into that gutter.
    const plotWidth = chart.timeScale().width();
    rail.style.right = 'auto';
    rail.style.width = `${plotWidth}px`;
    eventLayer.style.right = 'auto';
    eventLayer.style.width = `${plotWidth}px`;
    rail.replaceChildren();
    const segments = buildExposureRailSegments(
      current.points,
      Math.max(72, Math.min(120, Math.floor(plotWidth / 7))),
    );
    segments.forEach((segment, index) => {
      const left = coordinate(segment.date);
      if (left === null) return;
      const next = segments[index + 1];
      const right = next ? coordinate(next.date) : chart.timeScale().width();
      const span = document.createElement('span');
      span.className = 'chart-exposure-segment';
      span.title = `${segment.date} · ${segment.exposure.toFixed(1)}% nominal exposure`;
      span.style.left = `${Math.max(0, left)}px`;
      span.style.width = `${Math.max(1, (right ?? left + 2) - left + 0.5)}px`;
      span.style.background = segment.color;
      rail.append(span);
    });

    eventLayer.replaceChildren();
    currentEvents.forEach((event) => {
      const start = coordinate(event.startDate);
      const end = coordinate(event.endDate);
      if (start === null && end === null) return;
      const left = Math.max(0, start ?? 0);
      const right = Math.min(chart.timeScale().width(), end ?? chart.timeScale().width());
      const band = document.createElement('div');
      band.className = `chart-event-band${isClosedExposureEvent(event) ? '' : ' chart-event-band-open'}`;
      band.style.left = `${Math.min(left, right)}px`;
      band.style.width = `${Math.max(2, Math.abs(right - left))}px`;
      band.title = event.title ?? `事件 ${event.startDate} — ${event.endDate}`;
      eventLayer.append(band);
      const markerX = coordinate(event.peakDate ?? event.startDate);
      if (markerX === null) return;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'chart-event-marker';
      marker.style.left = `${Math.max(0, markerX - 6)}px`;
      marker.setAttribute('aria-label', event.title ?? `查看事件 ${event.startDate}`);
      marker.title = event.title ?? `${event.startDate} — ${event.endDate}`;
      marker.textContent = '•••';
      marker.addEventListener('click', () => eventClick?.(event));
      eventLayer.append(marker);
    });
  }

  chart.subscribeCrosshairMove((parameter) => {
    if (!parameter.time || !current) {
      tooltip.style.display = 'none';
      return;
    }
    const date = asDate(parameter.time);
    const point = current.points.find((item) => item.date === date);
    if (!point) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.innerHTML = formatChartPointTooltip(point);
    tooltip.style.display = 'block';
    const pointX = parameter.point?.x ?? 0;
    const pointY = parameter.point?.y ?? 0;
    const tooltipWidth = tooltip.offsetWidth || 320;
    const tooltipHeight = tooltip.offsetHeight || 230;
    const preferredTop = pointY - tooltipHeight - 14;
    const fallbackTop = pointY + 14;
    const position = clampTooltipPosition(
      pointX + 18,
      preferredTop >= 10 ? preferredTop : fallbackTop,
      host.clientWidth,
      host.clientHeight,
      tooltipWidth,
      tooltipHeight,
    );
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  });

  chart.timeScale().subscribeVisibleTimeRangeChange(scheduleOverlay);
  const observer = new ResizeObserver(() => {
    chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
    scheduleOverlay();
  });
  observer.observe(host);

  return {
    render(result, options = {}) {
      current = result;
      currentEvents = options.events ?? richerEvents(result);
      eventClick = options.onEventClick;
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
      scheduleOverlay();
    },
    setEvents(events, onEventClick) {
      currentEvents = events;
      eventClick = onEventClick;
      scheduleOverlay();
    },
    fit() {
      chart.timeScale().fitContent();
      scheduleOverlay();
    },
    setRange(years) {
      if (!current || years === 'all') {
        chart.timeScale().fitContent();
        scheduleOverlay();
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
      scheduleOverlay();
    },
    setLogarithmic(enabled) {
      for (const item of series) {
        item.priceScale().applyOptions({ mode: enabled ? 1 : 0 });
      }
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(scheduleOverlay);
      rail.remove();
      eventLayer.remove();
      chart.remove();
    },
  };
}
