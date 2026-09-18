import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PRESENTER_CONFIG_DIR } from "../core/paths.js";

/**
 * Persistent presenter identity. The same profile is reused across videos so
 * the channel keeps one recognisable host. Stored in config/presenter/.
 */
export const PresenterProfile = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  character_identity: z.string(),
  appearance: z.string(),
  clothing: z.string(),
  hairstyle: z.string(),
  age_range: z.string(),
  general_expression: z.string(),
  camera_framing: z.string(),
  lighting: z.string(),
  background_style: z.string(),
  /** Free-form prompt fragment; combined with style.json's template into the final avatar prompt. */
  presenter_prompt: z.string(),
  /** Paths relative to config/presenter/. First entry is the primary reference for image-to-video. */
  reference_images: z.array(z.string()).min(1),
  /** Preferred voice config id (config/voice/<id>.json); the user can override per request. */
  default_voice_id: z.string().default("default"),
});
export type PresenterProfile = z.infer<typeof PresenterProfile>;

export const PresenterRegistry = z.object({
  default: z.string(),
  presenters: z.record(z.string(), PresenterProfile),
});
export type PresenterRegistry = z.infer<typeof PresenterRegistry>;

/** Channel-wide style rules shared by every presenter profile. */
export const PresenterStyle = z.object({
  /** Template with {identity} {appearance} {clothing} {hairstyle} {age} {expression} {framing} {lighting} {background} {prompt} {mode_hints} placeholders. */
  prompt_template: z.string(),
  negative_prompt: z.string().default(""),
  /** Default share of the 9:16 frame the presenter occupies (Visual Director may change per scene). */
  default_height_fraction: z.number().min(0.15).max(1).default(0.45),
  /** Avatar generation defaults. */
  resolution: z.enum(["480p", "720p"]).default("480p"),
  /** Crop strategy when the avatar model's native aspect differs from the presenter panel. */
  crop: z.enum(["center", "face_weighted"]).default("face_weighted"),
  /** Edge treatment to blend the presenter panel into the scene. */
  blend: z.object({ feather_px: z.number().default(48), vignette: z.boolean().default(true), color_grade: z.boolean().default(true) }).default({ feather_px: 48, vignette: true, color_grade: true }),
});
export type PresenterStyle = z.infer<typeof PresenterStyle>;

export class PresenterProfileStore {
  constructor(private readonly dir: string = PRESENTER_CONFIG_DIR) {}

  registryPath(): string {
    return path.join(this.dir, "presenter.json");
  }

  stylePath(): string {
    return path.join(this.dir, "style.json");
  }

  loadRegistry(): PresenterRegistry {
    const raw = JSON.parse(fs.readFileSync(this.registryPath(), "utf8"));
    return PresenterRegistry.parse(raw);
  }

  loadStyle(): PresenterStyle {
    const raw = JSON.parse(fs.readFileSync(this.stylePath(), "utf8"));
    return PresenterStyle.parse(raw);
  }

  list(): PresenterProfile[] {
    return Object.values(this.loadRegistry().presenters);
  }

  get(id: string): PresenterProfile {
    const reg = this.loadRegistry();
    const key = id === "default" ? reg.default : id;
    const p = reg.presenters[key];
    if (!p) throw new Error(`Unknown presenter "${id}". Available: ${Object.keys(reg.presenters).join(", ")}`);
    return p;
  }

  /** Absolute path of the primary reference image. */
  referenceImagePath(profile: PresenterProfile): string {
    const rel = profile.reference_images[0];
    return path.isAbsolute(rel) ? rel : path.join(this.dir, rel);
  }

  /**
   * Resolve a presenter from natural language: "Use my default presenter",
   * "Use trading_host", "use the news host". Returns undefined when no
   * presenter is mentioned so the caller can fall back to the default.
   */
  resolveFromText(text: string): PresenterProfile | undefined {
    const reg = this.loadRegistry();
    const t = text.toLowerCase();
    const profiles = Object.values(reg.presenters);
    for (const p of profiles) {
      if (t.includes(p.id) || t.includes(p.id.replace(/_/g, " "))) return p;
    }
    for (const p of profiles) {
      if (t.includes(p.label.toLowerCase())) return p;
      if (p.aliases.some((a) => t.includes(a.toLowerCase()))) return p;
    }
    if (/\b(my )?default (presenter|host|avatar)\b/.test(t)) return reg.presenters[reg.default];
    return undefined;
  }

  /** Build the full text prompt for the avatar model from the profile, style template and mode hints. */
  buildAvatarPrompt(profile: PresenterProfile, modeHints: string[] = []): string {
    const style = this.loadStyle();
    const filled = style.prompt_template
      .replace("{identity}", profile.character_identity)
      .replace("{appearance}", profile.appearance)
      .replace("{clothing}", profile.clothing)
      .replace("{hairstyle}", profile.hairstyle)
      .replace("{age}", profile.age_range)
      .replace("{expression}", profile.general_expression)
      .replace("{framing}", profile.camera_framing)
      .replace("{lighting}", profile.lighting)
      .replace("{background}", profile.background_style)
      .replace("{prompt}", profile.presenter_prompt)
      .replace("{mode_hints}", modeHints.join(", "));
    return filled.replace(/\s+/g, " ").trim();
  }
}
