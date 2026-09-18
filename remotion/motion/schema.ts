import { z } from "zod";

/**
 * Declarative motion plan. Browser-safe (no node imports) because the
 * Remotion composition consumes it directly. Times are absolute seconds on
 * the beat timeline; each component animates its own stages inside
 * [start, end]. Coordinates are normalised (0–1) within the stage rect.
 */

export const Rect = z.object({ x: z.number().min(0).max(1).default(0), y: z.number().min(0).max(1).default(0), w: z.number().min(0.05).max(1).default(1), h: z.number().min(0.05).max(1).default(1) });
export type Rect = z.infer<typeof Rect>;

export const Timing = z.object({ start: z.number().min(0), end: z.number().positive() });

const Base = Timing.extend({ id: z.string(), rect: Rect.default({ x: 0, y: 0, w: 1, h: 1 }), z: z.number().int().default(0) });

export const Candle = z.tuple([z.number(), z.number(), z.number(), z.number()]); // open, high, low, close
export type Candle = z.infer<typeof Candle>;

export const CandlePattern = z.enum(["rally_sweep_reverse", "drop_sweep_reverse", "breakout_continuation", "fvg_gap_up", "fvg_gap_down", "range_chop", "trend_up", "trend_down"]);
export type CandlePattern = z.infer<typeof CandlePattern>;

export const CandleSource = z.union([
  z.object({ candles: z.array(Candle).min(5) }),
  z.object({ generate: z.object({ pattern: CandlePattern, count: z.number().int().min(8).max(120).default(40), seed: z.number().int().default(1), key_index: z.number().int().min(0).optional() }) }),
]);

/** Overlays live in the chart's price/time space (candle index + price). */
export const FVGBox = Timing.extend({
  kind: z.literal("FVGBox"),
  from_index: z.number().int().min(0),
  to_index: z.number().int().min(0).optional(),
  top: z.number(),
  bottom: z.number(),
  label: z.string().default("FVG"),
  inverted: z.boolean().default(false),
  color: z.string().optional(),
});
export const PriceLabel = Timing.extend({
  kind: z.literal("PriceLabel"),
  price: z.number(),
  label: z.string(),
  from_index: z.number().int().min(0).default(0),
  to_index: z.number().int().min(0).optional(),
  style: z.enum(["solid", "dashed"]).default("dashed"),
  color: z.string().optional(),
  emphasis: z.boolean().default(false),
});
export const Marker = Timing.extend({
  kind: z.literal("Marker"),
  index: z.number().int().min(0),
  price: z.number(),
  label: z.string(),
  shape: z.enum(["dot", "arrow_up", "arrow_down", "ring"]).default("dot"),
  color: z.string().optional(),
  pulse: z.boolean().default(true),
});
export const TradeSetup = Timing.extend({
  kind: z.literal("TradeSetup"),
  from_index: z.number().int().min(0),
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  side: z.enum(["long", "short"]).default("long"),
});
export const SessionRange = Timing.extend({
  kind: z.literal("SessionRange"),
  from_index: z.number().int().min(0),
  to_index: z.number().int().min(0),
  label: z.string(),
  color: z.string().optional(),
});
export const SweepHighlight = Timing.extend({
  kind: z.literal("SweepHighlight"),
  index: z.number().int().min(0),
  level: z.number(),
  label: z.string().default("SWEEP"),
  direction: z.enum(["above", "below"]).default("above"),
});
export const ChartOverlay = z.discriminatedUnion("kind", [FVGBox, PriceLabel, Marker, TradeSetup, SessionRange, SweepHighlight]);
export type ChartOverlay = z.infer<typeof ChartOverlay>;

export const CandlestickChartLayer = Base.extend({
  kind: z.literal("CandlestickChart"),
  source: CandleSource,
  title: z.string().default(""),
  /** Progressive reveal of candles over [start, reveal_until]; default 60 % of the layer. */
  reveal_fraction: z.number().min(0).max(1).default(0.6),
  overlays: z.array(ChartOverlay).default([]),
  show_grid: z.boolean().default(true),
});

/** Schematic (not candle-based) liquidity sweep diagram with staged animation. */
export const LiquiditySweepLayer = Base.extend({
  kind: z.literal("LiquiditySweep"),
  level_label: z.string().default("PREVIOUS HIGH"),
  sweep_label: z.string().default("SWEEP"),
  direction: z.enum(["high", "low"]).default("high"),
  reversal_label: z.string().default(""),
  /** Stage boundaries as fractions of the layer's duration: approach → break → wick → label → reverse → highlight. */
  stages: z.object({ approach: z.number().default(0.25), break: z.number().default(0.4), wick: z.number().default(0.5), label: z.number().default(0.6), reverse: z.number().default(0.85) }).default({ approach: 0.25, break: 0.4, wick: 0.5, label: 0.6, reverse: 0.85 }),
});

export const ArrowLayer = Base.extend({
  kind: z.literal("Arrow"),
  from: z.tuple([z.number(), z.number()]),
  to: z.tuple([z.number(), z.number()]),
  label: z.string().default(""),
  curved: z.boolean().default(false),
  color: z.string().optional(),
  thickness: z.number().default(8),
});

export const NumberCounterLayer = Base.extend({
  kind: z.literal("NumberCounter"),
  from: z.number().default(0),
  to: z.number(),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
  decimals: z.number().int().min(0).max(4).default(0),
  label: z.string().default(""),
  count_fraction: z.number().min(0.1).max(1).default(0.7),
});

export const HeadlineLayer = Base.extend({
  kind: z.literal("Headline"),
  text: z.string(),
  sub: z.string().default(""),
  style: z.enum(["pop", "slide_up", "typewriter", "split_words", "wipe"]).default("split_words"),
  size: z.enum(["s", "m", "l", "xl"]).default("l"),
  align: z.enum(["left", "center"]).default("center"),
  accent_words: z.array(z.string()).default([]),
});

export const LowerThirdLayer = Base.extend({
  kind: z.literal("LowerThird"),
  title: z.string(),
  subtitle: z.string().default(""),
  side: z.enum(["left", "right"]).default("left"),
});

export const TimelineLayer = Base.extend({
  kind: z.literal("Timeline"),
  steps: z.array(z.object({ label: z.string(), at: z.number().min(0) })).min(2),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
});

export const MotionLayer = z.discriminatedUnion("kind", [CandlestickChartLayer, LiquiditySweepLayer, ArrowLayer, NumberCounterLayer, HeadlineLayer, LowerThirdLayer, TimelineLayer]);
export type MotionLayer = z.infer<typeof MotionLayer>;

export const MotionTheme = z.object({
  bg: z.string().default("#0B0E14"),
  fg: z.string().default("#F4F6FA"),
  muted: z.string().default("#8A93A6"),
  accent: z.string().default("#4F8CFF"),
  up: z.string().default("#22D3A5"),
  down: z.string().default("#FF5A5A"),
  warn: z.string().default("#FFD84D"),
  font: z.string().default("Inter, Arial, sans-serif"),
  mono: z.string().default("JetBrains Mono, Menlo, monospace"),
});
export type MotionTheme = z.infer<typeof MotionTheme>;
export const DEFAULT_MOTION_THEME: MotionTheme = MotionTheme.parse({});

/** One beat's motion graphics. */
export const BeatMotion = z.object({
  beat_id: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  /** What this beat's animation communicates (agent's note for review). */
  concept: z.string().default(""),
  layers: z.array(MotionLayer).max(5),
  transition_in: z.enum(["none", "cut", "fade", "slide_left", "slide_up", "zoom"]).default("fade"),
});
export type BeatMotion = z.infer<typeof BeatMotion>;

export const MotionPlan = z.object({
  width: z.number().int().default(1080),
  height: z.number().int().default(1080),
  fps: z.number().int().default(30),
  theme: MotionTheme.prefault({}),
  beats: z.array(BeatMotion),
});
export type MotionPlan = z.infer<typeof MotionPlan>;

/** Props for the preview composition: render a slice of the plan (one beat or all). */
export const MotionPreviewProps = z.object({ plan: MotionPlan, from: z.number().min(0), to: z.number().positive() });
export type MotionPreviewProps = z.infer<typeof MotionPreviewProps>;
