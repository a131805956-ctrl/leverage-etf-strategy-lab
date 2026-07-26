import { describe, expect, it } from 'vitest';

import { scheduledRebalanceDue } from '../src/core/rebalance';

describe('scheduledRebalanceDue', () => {
  it('executes the first trading day after a weekend due date', () => {
    expect(
      scheduledRebalanceDue(
        { mode: 'calendar-interval', intervalDays: 30, driftThreshold: 5 },
        '2024-01-01',
        '2024-01-26',
        '2024-02-02',
      ),
    ).toBe(true);
  });

  it('does not drift later anchors after a delayed execution', () => {
    const config = {
      mode: 'calendar-interval',
      intervalDays: 30,
      driftThreshold: 5,
    } as const;

    expect(
      scheduledRebalanceDue(config, '2024-01-01', '2024-02-23', '2024-03-01'),
    ).toBe(true);
  });

  it('does not fire twice inside the same interval', () => {
    expect(
      scheduledRebalanceDue(
        { mode: 'calendar-interval', intervalDays: 30, driftThreshold: 5 },
        '2024-01-01',
        '2024-02-02',
        '2024-02-05',
      ),
    ).toBe(false);
  });

  it.each([
    ['monthly', '2024-01-31', '2024-02-01'],
    ['quarterly', '2024-03-29', '2024-04-01'],
    ['annual', '2024-12-31', '2025-01-01'],
  ] as const)('schedules %s rebalances on their calendar boundary', (mode, current, next) => {
    expect(
      scheduledRebalanceDue(
        { mode, driftThreshold: 5 },
        '2024-01-01',
        current,
        next,
      ),
    ).toBe(true);
  });

  it.each(['none', 'drift'] as const)('does not time-schedule %s rebalances', (mode) => {
    expect(
      scheduledRebalanceDue(
        { mode, driftThreshold: 5 },
        '2024-01-01',
        '2024-01-31',
        '2024-02-01',
      ),
    ).toBe(false);
  });
});
