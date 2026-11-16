import { BadRequestException } from '@nestjs/common';

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'year';
export type Bucket = 'hour' | 'day' | 'month';

export interface TimeRange {
  range: RangeKey;
  /** Inclusive start, as a UTC instant */
  from: Date;
  /** Exclusive end, as a UTC instant */
  to: Date;
  bucket: Bucket;
  /** Bucket keys in Lagos time, oldest first, in the format SQL_BUCKET_FORMAT gives */
  keys: string[];
}

/**
 * Fizco's users are in Nigeria, so "today" and calendar months follow Lagos time. Africa/Lagos is
 * UTC+1 all year (no daylight saving), so a fixed offset is exact
 */
export const LAGOS_OFFSET_HOURS = 1;
const OFFSET_MS = LAGOS_OFFSET_HOURS * 3_600_000;
const DAY_MS = 86_400_000;

/** to_char formats producing the same keys as bucketKey */
export const SQL_BUCKET_FORMAT: Record<Bucket, string> = {
  hour: 'YYYY-MM-DD"T"HH24',
  day: 'YYYY-MM-DD',
  month: 'YYYY-MM',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Key of the bucket holding a UTC instant, in Lagos time */
function bucketKey(utc: Date, bucket: Bucket): string {
  const l = new Date(utc.getTime() + OFFSET_MS);
  const month = `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}`;
  if (bucket === 'month') return month;
  const day = `${month}-${pad(l.getUTCDate())}`;
  return bucket === 'day' ? day : `${day}T${pad(l.getUTCHours())}`;
}

/** UTC instant at which a Lagos calendar date starts; month and day may overflow (Date.UTC rules) */
const lagosMidnight = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d) - OFFSET_MS);

export function resolveRange(
  query: { range?: RangeKey; month?: string; year?: string },
  now = new Date(),
): TimeRange {
  const range = query.range ?? '30d';
  const local = new Date(now.getTime() + OFFSET_MS);
  const [y, m, d] = [
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ];
  const tomorrow = lagosMidnight(y, m, d + 1);

  let from: Date;
  let to: Date;
  let bucket: Bucket;
  switch (range) {
    case 'today':
      [from, to, bucket] = [lagosMidnight(y, m, d), tomorrow, 'hour'];
      break;
    case '7d':
      [from, to, bucket] = [lagosMidnight(y, m, d - 6), tomorrow, 'day'];
      break;
    case '30d':
      [from, to, bucket] = [lagosMidnight(y, m, d - 29), tomorrow, 'day'];
      break;
    case 'month': {
      const match = /^(\d{4})-(\d{2})$/.exec(
        query.month ?? `${y}-${pad(m + 1)}`,
      );
      const month = match ? Number(match[2]) : 0;
      if (!match || month < 1 || month > 12) {
        throw new BadRequestException('month must look like 2026-11');
      }
      const year = Number(match[1]);
      [from, to, bucket] = [
        lagosMidnight(year, month - 1, 1),
        lagosMidnight(year, month, 1),
        'day',
      ];
      break;
    }
    case 'year': {
      const year = Number(query.year ?? y);
      if (!Number.isInteger(year) || year < 2000 || year > 3000) {
        throw new BadRequestException('year must look like 2026');
      }
      [from, to, bucket] = [
        lagosMidnight(year, 0, 1),
        lagosMidnight(year + 1, 0, 1),
        'month',
      ];
      break;
    }
    default:
      throw new BadRequestException('Unknown range');
  }

  const keys: string[] = [];
  for (let t = from; t < to;) {
    keys.push(bucketKey(t, bucket));
    t =
      bucket === 'hour'
        ? new Date(t.getTime() + 3_600_000)
        : bucket === 'day'
          ? new Date(t.getTime() + DAY_MS)
          : (() => {
              const l = new Date(t.getTime() + OFFSET_MS);
              return lagosMidnight(l.getUTCFullYear(), l.getUTCMonth() + 1, 1);
            })();
  }
  return { range, from, to, bucket, keys };
}

/** Lays SQL rows of (key, value) onto every bucket of the range, zero where there were none */
export function fillSeries(
  keys: string[],
  rows: Array<{ k: string; v: number }>,
): Array<{ key: string; value: number }> {
  const byKey = new Map(rows.map((r) => [r.k, Number(r.v)]));
  return keys.map((key) => ({ key, value: byKey.get(key) ?? 0 }));
}

/** The twelve Lagos months ending with the current one: where they start, and their YYYY-MM keys */
export function lastTwelveMonths(now = new Date()): {
  from: Date;
  keys: string[];
} {
  const local = new Date(now.getTime() + OFFSET_MS);
  const from = lagosMidnight(
    local.getUTCFullYear(),
    local.getUTCMonth() - 11,
    1,
  );
  const keys: string[] = [];
  for (let i = 0; i < 12; i++) {
    keys.push(
      bucketKey(
        lagosMidnight(local.getUTCFullYear(), local.getUTCMonth() - 11 + i, 1),
        'month',
      ),
    );
  }
  return { from, keys };
}
