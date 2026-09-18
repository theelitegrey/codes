import { interpolate } from "remotion";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Progress 0..1 of [a, b] at time t (seconds), clamped. */
export const prog = (t: number, a: number, b: number) => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

export const fadeInOut = (t: number, start: number, end: number, dur = 0.3) => Math.min(prog(t, start, start + dur), 1 - prog(t, end - dur, end));

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return interpolate(v, [inMin, inMax], [outMin, outMax], { extrapolateLeft: "extend", extrapolateRight: "extend" });
}

export const HEADLINE_PX: Record<"s" | "m" | "l" | "xl", number> = { s: 48, m: 64, l: 84, xl: 110 };
