import fs from "node:fs";
import path from "node:path";
import { ShortMode } from "../core/project.js";
import { PRESET_CONFIG_DIR } from "../core/paths.js";
import { ModePreset, BUILTIN_PRESETS } from "./schema.js";

export { ModePreset, BUILTIN_PRESETS } from "./schema.js";

/** Loads a preset, preferring an on-disk override at config/presets/<MODE>.json. */
export function getModePreset(mode: ShortMode): ModePreset {
  const file = path.join(PRESET_CONFIG_DIR, `${mode}.json`);
  if (fs.existsSync(file)) {
    const parsed = ModePreset.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (parsed.success) return parsed.data;
    throw new Error(`Invalid preset ${file}: ${parsed.error.message}`);
  }
  return BUILTIN_PRESETS[mode];
}

export function listModes(): ShortMode[] {
  return ShortMode.options;
}

export function builtinPresets(): Record<ShortMode, ModePreset> {
  return BUILTIN_PRESETS;
}

/** Parse "podcast", "news mode", "TRADING" etc. from free text. */
export function parseModeFromText(text: string): ShortMode | undefined {
  const t = text.toLowerCase();
  if (/\bfull[\s-]?screen\b/.test(t)) return "FULLSCREEN";
  if (/\bpodcast\b/.test(t)) return "PODCAST_SHORT";
  if (/\bnews\b/.test(t)) return "NEWS";
  if (/\btrading\b|\bchart[- ]heavy\b/.test(t)) return "TRADING";
  if (/\beducational\b|\bexplainer\b|\bteach\b/.test(t)) return "EDUCATIONAL";
  if (/\bcinematic\b/.test(t)) return "CINEMATIC";
  return undefined;
}
