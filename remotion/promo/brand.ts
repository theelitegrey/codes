import { z } from "zod";

export const Brand = z.object({
  name: z.string(),
  sub: z.string(),
  url: z.string(),
  tagline: z.string(),
  colors: z.object({ bg: z.string(), bgElevated: z.string(), panel: z.string(), line: z.string(), fg: z.string(), muted: z.string(), accent: z.string(), accent2: z.string(), up: z.string(), down: z.string(), warn: z.string() }),
  font: z.string(),
  mono: z.string(),
});
export type Brand = z.infer<typeof Brand>;

export const Word = z.object({ word: z.string(), start: z.number(), end: z.number() });
export type Word = z.infer<typeof Word>;

export const Beat = z.object({
  id: z.string(),
  /** hook | problem | solution | features | how | challenge | results | cta */
  kind: z.enum(["hook", "problem", "solution", "features", "how", "challenge", "results", "cta"]),
  start: z.number(),
  end: z.number(),
  label: z.string(),
});
export type Beat = z.infer<typeof Beat>;

export const StrykerPromoProps = z.object({
  brand: Brand,
  words: z.array(Word),
  beats: z.array(Beat),
  duration: z.number(),
  /** Words rendered with the accent highlight treatment. */
  emphasis: z.array(z.string()),
  /** Fraction of frame height reserved for the presenter. */
  presenterFraction: z.number().default(0.46),
  /** When set, the presenter layer is composited in Remotion instead of with ffmpeg. */
  presenterSrc: z.string().nullable().default(null),
});
export type StrykerPromoProps = z.infer<typeof StrykerPromoProps>;
