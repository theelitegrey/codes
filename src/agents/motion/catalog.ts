/** Component catalog shown to the agent. Keep in sync with remotion/motion/schema.ts. */
export const MOTION_CATALOG = `
COMPONENTS (layer.kind) — all layers: id, start, end, rect {x,y,w,h in 0–1}, z
- CandlestickChart: source = {generate:{pattern, count, seed, key_index?}} | {candles:[[o,h,l,c],…]}; title; reveal_fraction (share of the layer during which candles appear); show_grid; overlays[] in price/time space:
    • FVGBox {from_index, to_index?, top, bottom, label, inverted}
    • PriceLabel {price, label, from_index, to_index?, style solid|dashed, emphasis}
    • Marker {index, price, label, shape dot|arrow_up|arrow_down|ring, pulse}
    • TradeSetup {from_index, entry, stop, target, side long|short}
    • SessionRange {from_index, to_index, label}
    • SweepHighlight {index, level, label, direction above|below}
  patterns: rally_sweep_reverse (rallies, sweeps the prior high at key_index, reverses; key_level ≈ that high), drop_sweep_reverse, breakout_continuation, fvg_gap_up, fvg_gap_down (gap candle at key_index), range_chop, trend_up, trend_down.
  Generated prices start near 100 and move ~0.5–1 per candle; a sweep wick pokes ~1.5–2 above the key level. Use these ranges when writing overlay prices.
- LiquiditySweep: schematic diagram; level_label, sweep_label, direction high|low, reversal_label, stages {approach, break, wick, label, reverse} as fractions of the layer duration (increasing, < 1).
- Arrow: from [x,y], to [x,y] (0–1), label, curved, thickness, color.
- NumberCounter: from, to, prefix, suffix, decimals, label, count_fraction.
- Headline: text, sub, style pop|slide_up|typewriter|split_words|wipe, size s|m|l|xl, align, accent_words[].
- LowerThird: title, subtitle, side left|right.
- Timeline: steps [{label, at}] (at = absolute seconds each step appears), orientation.

BEAT: beat_id, start, end, concept, transition_in none|cut|fade|slide_left|slide_up|zoom, layers[] (max 5).
`;
