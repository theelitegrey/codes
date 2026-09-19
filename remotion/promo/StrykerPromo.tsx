import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { StrykerPromoProps } from "./brand.js";
import { BrandFrame, Stage, clamp01, easeOut, prog } from "./ui.js";
import { SCENES } from "./scenes.js";

/**
 * Stryker Trading Academy promo — 9:16.
 *
 * Upper zone: per-beat motion graphics that change with the narration.
 * Lower zone: a branded stage reserved for Richard (HeyGen alpha webm),
 *             composited here when `presenterSrc` is set, otherwise left as
 *             the stage so the layer can be merged with ffmpeg.
 * Across both: kinetic captions driven by HeyGen's word timestamps.
 */
export const StrykerPromo: React.FC<StrykerPromoProps> = (props) => {
  const { brand, beats, words, duration, presenterFraction, presenterSrc } = props;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const presenterTop = Math.round(height * (1 - presenterFraction));
  const emphasis = new Set(props.emphasis.map((w) => w.toUpperCase()));

  const beat = beats.find((b) => t >= b.start && t < b.end) ?? beats[beats.length - 1];
  const Scene = SCENES[beat.kind];
  // Punch-in on every scene change keeps the upper zone moving.
  const since = t - beat.start;
  const punch = 1 + 0.035 * (1 - easeOut(clamp01(since / 0.55)));

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.bg, overflow: "hidden" }}>
      <Stage brand={brand} t={t} />

      {/* ---------- upper zone: motion graphics ---------- */}
      <div style={{ position: "absolute", left: 0, top: 0, width, height: presenterTop + 40, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${punch})`, transformOrigin: "50% 42%" }}>
          <Scene brand={brand} t={t} start={beat.start} end={beat.end} w={width} h={presenterTop} />
        </div>
        {/* scene-change wipe */}
        <SceneWipe brand={brand} t={t} start={beat.start} />
      </div>

      {/* ---------- lower zone: presenter stage ---------- */}
      <div style={{ position: "absolute", left: 0, top: presenterTop, width, height: height - presenterTop }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${brand.colors.bg}00 0%, ${brand.colors.bgElevated} 22%, ${brand.colors.bg} 100%)` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: `linear-gradient(90deg, transparent, ${brand.colors.accent}, transparent)`, opacity: 0.8 }} />
        {/* floor glow keeps the cut-out presenter grounded */}
        <div style={{ position: "absolute", left: "50%", top: 40, width: 900, height: 900, transform: "translateX(-50%)", background: `radial-gradient(50% 50% at 50% 50%, ${brand.colors.accent}1A 0%, transparent 70%)` }} />
        {presenterSrc && (
          <OffthreadVideo
            src={staticFile(presenterSrc)}
            transparent
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 22%", transform: `scale(${1.02 + 0.02 * Math.sin(t / 3)})`, transformOrigin: "50% 30%" }}
          />
        )}
      </div>

      {/* ---------- captions ---------- */}
      <KineticCaptions words={words} t={t} brand={brand} emphasis={emphasis} bottom={height - presenterTop + 34} width={width} />

      <BrandFrame brand={brand} t={t} duration={duration} />
    </AbsoluteFill>
  );
};

/** A fast light wipe on each scene boundary. */
const SceneWipe: React.FC<{ brand: { colors: { accent: string } }; t: number; start: number }> = ({ brand, t, start }) => {
  const p = prog(t, start, start + 0.32);
  if (p <= 0 || p >= 1) return null;
  return <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, transparent 35%, ${brand.colors.accent}30 50%, transparent 65%)`, transform: `translateX(${(p - 0.5) * 2600}px)` }} />;
};


/**
 * Cuts the narration into caption phrases. A phrase breaks on sentence
 * punctuation, on a pause in the delivery, or once it is long enough to read
 * in one glance. Short trailing fragments are pulled back into the phrase
 * before them so no line is left dangling on a word or two.
 */
function buildPhrases(words: StrykerPromoProps["words"]): Array<{ from: number; to: number }> {
  const MAX_WORDS = 5;
  const PAUSE = 0.16;

  /** How natural a break after word i is. Higher wins. */
  const score = (i: number): number => {
    if (i >= words.length - 1) return 100;
    if (/[.!?]$/.test(words[i].word)) return 90;
    if (/[,;:]$/.test(words[i].word)) return 70;
    const gap = words[i + 1].start - words[i].end;
    if (gap > PAUSE) return 40 + Math.min(20, gap * 40);
    return 0;
  };

  const out: Array<{ from: number; to: number }> = [];
  let from = 0;
  while (from < words.length) {
    const limit = Math.min(from + MAX_WORDS - 1, words.length - 1);
    // Take the best boundary in range; on a tie the later one wins, which
    // keeps lines full instead of trickling out two words at a time.
    let bestAt = limit;
    let best = -1;
    for (let i = from; i <= limit; i++) {
      const sc = score(i);
      if (sc >= best) { best = sc; bestAt = i; }
    }
    out.push({ from, to: bestAt });
    from = bestAt + 1;
  }

  // Merge a one-word tail into its neighbour rather than flashing it alone.
  for (let i = out.length - 1; i > 0; i--) {
    const len = out[i].to - out[i].from + 1;
    const prevLen = out[i - 1].to - out[i - 1].from + 1;
    if (len === 1 && prevLen + len <= MAX_WORDS + 1) {
      out[i - 1].to = out[i].to;
      out.splice(i, 1);
    }
  }
  return out;
}

/**
 * Word-timed captions. Words are grouped into short phrases; the spoken word
 * is boxed in the accent colour, emphasis keywords are rendered larger and
 * glowing, and a phrase ending in a full stop gets a full-screen moment.
 */
export const KineticCaptions: React.FC<{ words: StrykerPromoProps["words"]; t: number; brand: StrykerPromoProps["brand"]; emphasis: Set<string>; bottom: number; width: number }> = ({ words, t, brand, emphasis, bottom, width }) => {
  // Phrases are cut ONCE over the whole narration, not recomputed per frame.
  // A sliding window re-cut on every word, which made the line jump and threw
  // up orphan fragments like "ME THE PART I".
  const groups = React.useMemo(() => buildPhrases(words), [words]);

  const idx = words.findIndex((w) => t >= w.start && t < w.end + 0.12);
  const active = idx >= 0 ? idx : words.findIndex((w) => w.start > t) - 1;
  if (active < 0 || active >= words.length) return null;

  const g = groups.find((x) => active >= x.from && active <= x.to);
  if (!g) return null;
  const phrase = words.slice(g.from, g.to + 1);
  const startI = g.from;
  const key = phrase.find((w) => emphasis.has(w.word.replace(/[^A-Za-z]/g, "").toUpperCase()));
  const hero = Boolean(key) && phrase.length <= 3;
  const inP = easeOut(prog(t, phrase[0].start, phrase[0].start + 0.14));

  return (
    <div style={{ position: "absolute", left: 40, right: 40, // Anchored from the bottom so a wrapped second line grows upward,
      // away from the presenter, instead of down across the divider.
      bottom: hero ? bottom + 168 : bottom, display: "flex", flexWrap: "wrap", columnGap: hero ? 26 : 20, rowGap: 6, justifyContent: "center", alignItems: "baseline", pointerEvents: "none", transform: `scale(${0.96 + 0.04 * inP})` }}>
      {phrase.map((w, i) => {
        const clean = w.word.replace(/[^A-Za-z]/g, "").toUpperCase();
        const isKey = emphasis.has(clean);
        const isActive = startI + i === active;
        // A one-character word in a filled box reads as a blob, so leave it plain.
        const boxed = isActive && !isKey && w.word.replace(/[^A-Za-z0-9]/g, "").length > 1;
        const size = isKey ? (hero ? 118 : 74) : 58;
        return (
          <span
            key={i}
            style={{
              fontFamily: brand.font,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 1.05,
              letterSpacing: isKey ? -1 : 0,
              textTransform: "uppercase",
              color: boxed ? "#06080C" : isKey ? brand.colors.accent : brand.colors.fg,
              background: boxed ? brand.colors.fg : "transparent",
              padding: boxed ? "0 0.16em" : 0,
              borderRadius: 10,
              textShadow: isKey ? `0 0 40px ${brand.colors.accent}AA, 0 6px 30px rgba(0,0,0,0.6)` : "0 6px 26px rgba(0,0,0,0.75)",
              transform: isActive ? "translateY(-2px) scale(1.04)" : "none",
              display: "inline-block",
              WebkitTextStroke: isKey ? `1px ${brand.colors.accent}55` : undefined,
            }}
          >
            {w.word.replace(/[,.]$/, "")}
          </span>
        );
      })}
    </div>
  );
};
