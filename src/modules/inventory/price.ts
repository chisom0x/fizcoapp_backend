// Mirrored in the app (lib/features/inventory/domain/price_parser.dart) so it can stop a listing
// before upload; keep the two in step.
//
// A candidate is an amount, optionally scaled by k / m / million. It counts as a price when it
// carries a currency or price marker (₦450,000 · N450k · NGN 1.2m · 450000 naira · price: 9000),
// or, unmarked, when it is at least ₦10,000 — small bare numbers are model numbers, years and
// sizes (iPhone 13, 2019, 4K).
const PRICE_PATTERN =
  /(?<![a-z0-9])(?:(₦|ngn|n|price|cost)\s*[:=-]?\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|million)?(?:\s*(naira|ngn)(?![a-z0-9])|(?![a-z0-9]))/gi;

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, million: 1e6 };
const MIN_UNMARKED_PRICE = 10_000;
// Fits the Int column; also keeps phone numbers and IMEIs from reading as prices
const MAX_PRICE = 1_000_000_000;

/** The first price written in a vendor's listing, in whole naira, or null if there is none */
export function extractPrice(text: string): number | null {
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const [, marker, whole, fraction, unit, suffix] = match;
    const digits = whole.replace(/,/g, '');
    const amount = Number(fraction ? `${digits}.${fraction}` : digits);
    const value = Math.round(amount * (unit ? MULTIPLIERS[unit.toLowerCase()] : 1));
    const isMarked = Boolean(marker || suffix);

    if (value <= 0 || value > MAX_PRICE) continue;
    // A leading zero is a phone number, not an amount
    if (!isMarked && (value < MIN_UNMARKED_PRICE || /^0\d/.test(digits))) continue;
    return value;
  }
  return null;
}

export function formatNaira(price: number): string {
  return `₦${price.toLocaleString('en-NG')}`;
}

export const MISSING_PRICE_MESSAGE =
  'Add the price to your listing, e.g. "iPhone 13, 128GB, UK used, ₦450,000"';
