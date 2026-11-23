/**
 * Deterministic seeded PRNG — Mulberry32.
 *
 * Returns a function that produces pseudo-random floats in [0, 1).
 * Given the same seed, the sequence is always identical, which makes
 * every turn in the simulation fully reproducible.
 *
 * @param {number} seed  32-bit integer seed
 * @returns {() => number}  Generator function returning [0, 1)
 */
export function mulberry32(seed) {
  let t = seed | 0;
  return function next() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
