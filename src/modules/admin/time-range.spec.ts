import { fillSeries, lastTwelveMonths, resolveRange } from './time-range';

// 23:30 UTC on 16 Nov 2026 is already 17 Nov in Lagos (UTC+1)
const now = new Date('2026-11-16T23:30:00Z');

describe('resolveRange', () => {
  it('starts "today" at Lagos midnight and buckets it by hour', () => {
    const r = resolveRange({ range: 'today' }, now);
    expect(r.from.toISOString()).toBe('2026-11-16T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-17T23:00:00.000Z');
    expect(r.keys).toHaveLength(24);
    expect(r.keys[0]).toBe('2026-11-17T00');
    expect(r.keys[23]).toBe('2026-11-17T23');
  });

  it('covers 7 and 30 whole days ending today', () => {
    const week = resolveRange({ range: '7d' }, now);
    expect(week.keys).toHaveLength(7);
    expect(week.keys[0]).toBe('2026-11-11');
    expect(week.keys[6]).toBe('2026-11-17');
    expect(resolveRange({ range: '30d' }, now).keys).toHaveLength(30);
  });

  it('covers a chosen calendar month by day', () => {
    const r = resolveRange({ range: 'month', month: '2026-02' }, now);
    expect(r.from.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(r.keys).toHaveLength(28);
  });

  it('covers a chosen year by month', () => {
    const r = resolveRange({ range: 'year', year: '2025' }, now);
    expect(r.keys).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('rejects malformed months', () => {
    expect(() =>
      resolveRange({ range: 'month', month: '2026-13' }, now),
    ).toThrow();
    expect(() => resolveRange({ range: 'month', month: 'nov' }, now)).toThrow();
  });
});

describe('fillSeries', () => {
  it('puts zero in buckets with no rows', () => {
    expect(fillSeries(['a', 'b', 'c'], [{ k: 'b', v: 3 }])).toEqual([
      { key: 'a', value: 0 },
      { key: 'b', value: 3 },
      { key: 'c', value: 0 },
    ]);
  });
});

describe('lastTwelveMonths', () => {
  it('ends with the current Lagos month', () => {
    const { from, keys } = lastTwelveMonths(new Date('2026-12-31T23:30:00Z'));
    expect(keys[0]).toBe('2026-02');
    expect(keys[11]).toBe('2027-01');
    expect(from.toISOString()).toBe('2026-01-31T23:00:00.000Z');
  });
});
