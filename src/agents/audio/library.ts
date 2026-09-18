import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_DIR } from "../../core/paths.js";
import { env } from "../../core/env.js";
import { ffmpegBin, run } from "../../media/ffmpeg.js";
import type { SfxType } from "./schema.js";

/**
 * Local music / SFX library. Drop files in config/audio/music and
 * config/audio/sfx and describe them in library.json. No generation API is
 * used for music; when nothing matches, the mix runs without a bed. SFX that
 * are missing from the library are synthesised procedurally with FFmpeg.
 */
export const LibraryManifest = z.object({
  music: z.array(z.object({ file: z.string(), genre: z.string(), mood: z.string(), tags: z.array(z.string()).default([]), bpm: z.number().optional(), license: z.string().default("") })).default([]),
  sfx: z.array(z.object({ file: z.string(), type: z.string(), tags: z.array(z.string()).default([]) })).default([]),
});
export type LibraryManifest = z.infer<typeof LibraryManifest>;

export class AudioLibrary {
  readonly dir: string;
  constructor(dir: string = env("SHORTS_AUDIO_DIR") ?? path.join(CONFIG_DIR, "audio")) {
    this.dir = dir;
  }

  manifest(): LibraryManifest {
    const f = path.join(this.dir, "library.json");
    if (!fs.existsSync(f)) return { music: [], sfx: [] };
    return LibraryManifest.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  }

  /** Best music match by genre/mood/tag overlap; undefined when the library is empty or nothing overlaps. */
  findMusic(genre: string, mood: string, tags: string[]): string | undefined {
    const wanted = new Set([genre, mood, ...tags].map((t) => t.toLowerCase()).filter(Boolean));
    let best: { file: string; score: number } | undefined;
    for (const m of this.manifest().music) {
      const have = [m.genre, m.mood, ...m.tags].map((t) => t.toLowerCase());
      const score = have.filter((t) => wanted.has(t)).length;
      const file = path.resolve(this.dir, m.file);
      if (score > 0 && fs.existsSync(file) && (!best || score > best.score)) best = { file, score };
    }
    return best?.file;
  }

  findSfx(type: SfxType): string | undefined {
    for (const s of this.manifest().sfx) {
      const file = path.resolve(this.dir, s.file);
      if (s.type === type && fs.existsSync(file)) return file;
    }
    return undefined;
  }
}

/** Procedural SFX (48 kHz mono WAV) so a cue never silently disappears. */
export async function synthesizeSfx(type: SfxType, outFile: string): Promise<string> {
  const inputs: string[] = [];
  let filter = "";
  switch (type) {
    case "whoosh":
      inputs.push("anoisesrc=d=0.7:c=pink:a=0.7");
      filter = "[0:a]highpass=f=300,lowpass=f=5000,afade=t=in:d=0.3,afade=t=out:st=0.35:d=0.35[out]";
      break;
    case "transition":
      inputs.push("anoisesrc=d=0.55:c=pink:a=0.6");
      filter = "[0:a]bandpass=f=1400:w=900,afade=t=in:d=0.2,afade=t=out:st=0.25:d=0.3[out]";
      break;
    case "hit":
      inputs.push("sine=f=80:d=0.6", "anoisesrc=d=0.12:c=white:a=0.5");
      filter = "[0:a]afade=t=out:st=0.05:d=0.55[s];[1:a]afade=t=out:d=0.12[n];[s][n]amix=inputs=2:normalize=0[out]";
      break;
    case "impact":
      inputs.push("sine=f=55:d=0.9", "anoisesrc=d=0.2:c=brown:a=0.8");
      filter = "[0:a]afade=t=out:st=0.1:d=0.8[s];[1:a]lowpass=f=1500,afade=t=out:d=0.2[n];[s][n]amix=inputs=2:normalize=0,volume=1.4[out]";
      break;
    case "click":
      inputs.push("sine=f=2200:d=0.035");
      filter = "[0:a]afade=t=out:d=0.03,volume=0.8[out]";
      break;
    case "rise":
      inputs.push("aevalsrc=sin(2*PI*t*(180+320*t))*0.6:d=1.6:s=48000");
      filter = "[0:a]afade=t=in:d=1.2,afade=t=out:st=1.35:d=0.25[out]";
      break;
    case "notification":
      inputs.push("sine=f=880:d=0.12", "sine=f=1320:d=0.18");
      filter = "[0:a]afade=t=out:st=0.06:d=0.06[a];[1:a]adelay=130|130,afade=t=out:st=0.08:d=0.1[b];[a][b]amix=inputs=2:normalize=0,volume=0.6[out]";
      break;
    case "chart_movement":
      inputs.push("anoisesrc=d=0.45:c=brown:a=0.5");
      filter = "[0:a]highpass=f=900,tremolo=f=14:d=0.9,afade=t=out:st=0.25:d=0.2[out]";
      break;
  }
  const args = ["-y"];
  for (const i of inputs) args.push("-f", "lavfi", "-i", i);
  args.push("-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", outFile);
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`SFX synth (${type}) failed: ${r.stderr.slice(-800)}`);
  return outFile;
}
