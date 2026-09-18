import type { Candle, CandlePattern } from "./schema.js";

/** Deterministic pseudo-random generator so the same seed renders the same chart. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates illustrative candles for a named pattern. `key_index` marks the
 * event candle (sweep / gap / break); defaults to ~60 % through the series.
 */
export function generateCandles(pattern: CandlePattern, count = 40, seed = 1, keyIndex?: number): { candles: Candle[]; key_index: number; key_level: number } {
  const rnd = mulberry32(seed);
  const key = keyIndex ?? Math.floor(count * 0.6);
  const candles: Candle[] = [];
  let price = 100;
  let keyLevel = 100;
  const noise = () => (rnd() - 0.5) * 1.2;
  const push = (o: number, c: number, extraHigh = 0, extraLow = 0) => {
    const hi = Math.max(o, c) + Math.abs(noise()) * 0.6 + extraHigh;
    const lo = Math.min(o, c) - Math.abs(noise()) * 0.6 - extraLow;
    candles.push([+o.toFixed(2), +hi.toFixed(2), +lo.toFixed(2), +c.toFixed(2)]);
  };
  for (let i = 0; i < count; i++) {
    const o = price;
    let c = price;
    switch (pattern) {
      case "rally_sweep_reverse":
      case "drop_sweep_reverse": {
        const up = pattern === "rally_sweep_reverse";
        const s = up ? 1 : -1;
        if (i < key * 0.45) c = o + s * (0.6 + noise() * 0.5);
        else if (i < key) c = o + noise() * 0.9;
        if (i === Math.floor(key * 0.45)) keyLevel = up ? Math.max(...candles.map((k) => k[1]), o + 1) : Math.min(...candles.map((k) => k[2]), o - 1);
        if (i === key) {
          c = keyLevel - s * 0.4;
          push(o, c, up ? Math.abs(keyLevel - o) + 1.8 : 0, up ? 0 : Math.abs(o - keyLevel) + 1.8);
          price = c;
          continue;
        }
        if (i > key) c = o - s * (0.9 + Math.abs(noise()) * 0.8);
        break;
      }
      case "breakout_continuation":
        if (i < key) c = o + noise() * 0.8;
        else c = o + 0.9 + Math.abs(noise()) * 0.7;
        if (i === key - 1) keyLevel = Math.max(...candles.map((k) => k[1]));
        break;
      case "fvg_gap_up":
      case "fvg_gap_down": {
        const s = pattern === "fvg_gap_up" ? 1 : -1;
        if (i < key) c = o + noise() * 0.8;
        else if (i === key) {
          c = o + s * 4.5;
          keyLevel = o;
        } else c = o + s * 0.4 + noise() * 0.6;
        break;
      }
      case "range_chop":
        c = o + noise() * 1.1 - (o - 100) * 0.15;
        keyLevel = 100;
        break;
      case "trend_up":
        c = o + 0.5 + noise() * 0.6;
        break;
      case "trend_down":
        c = o - 0.5 + noise() * 0.6;
        break;
    }
    push(o, c);
    price = c;
  }
  return { candles, key_index: key, key_level: +keyLevel.toFixed(2) };
}
