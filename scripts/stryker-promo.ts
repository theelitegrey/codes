/**
 * Renders the Stryker Trading Academy promo graphics layer (9:16) from the
 * HeyGen narration word timestamps in data/stryker/narration.json.
 *
 *   npx tsx scripts/stryker-promo.ts             → graphics layer, no presenter
 *   npx tsx scripts/stryker-promo.ts richard.webm → full composite (presenter file must be local)
 */
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../src/core/env.js";
import { renderComposition } from "../src/media/render.js";
import { Brand, type StrykerPromoProps } from "../remotion/promo/brand.js";

loadDotEnv();
const root = path.resolve("output/stryker");
const NARRATION = path.join(process.cwd(), "data", "stryker", "narration.json");
const narration = JSON.parse(fs.readFileSync(NARRATION, "utf8")) as { duration: number; words: Array<{ word: string; start: number; end: number }> };
const brand = Brand.parse(JSON.parse(fs.readFileSync("config/brand/stryker.json", "utf8")));

/** Beat boundaries taken from the measured word timings. */
const beats: StrykerPromoProps["beats"] = [
  { id: "b1", kind: "hook", start: 0, end: 4.52, label: "Hook" },
  { id: "b2", kind: "problem", start: 4.52, end: 10.58, label: "Problem" },
  { id: "b3", kind: "solution", start: 10.58, end: 15.82, label: "Stryker" },
  { id: "b4", kind: "features", start: 15.82, end: 23.6, label: "Features" },
  { id: "b5", kind: "how", start: 23.6, end: 30.26, label: "How he used it" },
  { id: "b6", kind: "challenge", start: 30.26, end: 35.0, label: "Challenge" },
  { id: "b7", kind: "results", start: 35.0, end: 37.22, label: "Results" },
  { id: "b8", kind: "cta", start: 37.22, end: narration.duration + 0.6, label: "CTA" },
];

const presenter = process.argv[2];
const props: StrykerPromoProps = {
  brand,
  words: narration.words,
  beats,
  duration: narration.duration + 0.6,
  emphasis: ["PASSED", "CHALLENGE", "PROCESS", "LIQUIDITY", "SETUP", "SETUPS", "RISK", "JOURNAL", "PAYOUT", "EXECUTE"],
  presenterFraction: 0.46,
  presenterSrc: presenter ? path.basename(presenter) : null,
};
fs.writeFileSync(path.join(root, "promo-props.json"), JSON.stringify(props, null, 2));
if (presenter && path.resolve(presenter) !== path.join(root, path.basename(presenter))) fs.copyFileSync(presenter, path.join(root, path.basename(presenter)));

const out = path.join(root, presenter ? "stryker-final.mp4" : "stryker-graphics.mp4");
await renderComposition("StrykerPromo", props as unknown as Record<string, unknown>, root, out);
console.log(out);
