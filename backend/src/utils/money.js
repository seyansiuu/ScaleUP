/**
 * Monetary and basis-point utility functions.
 *
 * All monetary values are stored as integer cents.
 * All percentages are stored as integer basis points (10 000 bps = 100.00%).
 */

/**
 * Convert a BigInt (or number) cents value to a plain Number.
 * Safe for values ≤ Number.MAX_SAFE_INTEGER (~$90 trillion).
 */
export function centsToNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/**
 * Format integer cents as a dollar string: 499 → "$4.99"
 */
export function centsToDollars(cents) {
  const num = typeof cents === 'bigint' ? Number(cents) : cents;
  return `$${(num / 100).toFixed(2)}`;
}

/**
 * Format integer cents as a compact dollar string for large amounts:
 * 150000000 → "$1.50M", 4900 → "$49.00"
 */
export function centsToCompact(cents) {
  const num = typeof cents === 'bigint' ? Number(cents) : cents;
  const dollars = num / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Convert basis points to a percentage string: 2500 → "25.00%"
 */
export function bpsToPercent(bps) {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Recursively serialize BigInt values to Number in a plain object / array.
 * Used for JSON.stringify compatibility since BigInt is not JSON-serializable.
 */
export function serializeBigInts(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}
