import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Shared project manifest. Agents never talk to each other; each writes its
 * artifacts into its folder and the Director/Composer records them here.
 *
 * /output/projects/<id>/
 *   project.json  script/  text/  audio/  motion/  illustration/  presenter/
 *   captions/  composition/  renders/  qa/
 */
export const ArtifactRef = z.object({ path: z.string(), version: z.number().int().default(1), status: z.enum(["pending", "ok", "failed", "skipped"]).default("pending"), detail: z.string().default(""), updated_at: z.string() });
export type ArtifactRef = z.infer<typeof ArtifactRef>;

export const BrandSettings = z.object({
  channel: z.string().default("My Channel"),
  mode: z.string().default("PODCAST_SHORT"),
  presenter_id: z.string().default("default"),
  voice_id: z.string().optional(),
  caption_style: z.string().default("Podcast"),
  platform: z.enum(["youtube_shorts", "tiktok", "instagram_reels"]).default("youtube_shorts"),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  style_brief: z.string().default("clean, modern, dark, high-contrast"),
});
export type BrandSettings = z.infer<typeof BrandSettings>;

export const ProjectManifest = z.object({
  id: z.string(),
  created_at: z.string(),
  instruction: z.string(),
  brand: BrandSettings,
  artifacts: z.record(z.string(), ArtifactRef).default({}),
  log: z.array(z.object({ at: z.string(), agent: z.string(), message: z.string() })).default([]),
});
export type ProjectManifest = z.infer<typeof ProjectManifest>;

export const PROJECT_DIRS = ["script", "text", "audio", "motion", "illustration", "presenter", "captions", "composition", "renders", "qa"] as const;

export class Project {
  readonly dir: string;
  manifest: ProjectManifest;

  private constructor(dir: string, manifest: ProjectManifest) {
    this.dir = dir;
    this.manifest = manifest;
  }

  static create(root: string, instruction: string, brand: Partial<BrandSettings> = {}, id?: string): Project {
    const pid = id ?? `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${instruction.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}`;
    const dir = path.resolve(root, pid);
    for (const d of PROJECT_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const p = new Project(dir, ProjectManifest.parse({ id: pid, created_at: new Date().toISOString(), instruction, brand: BrandSettings.parse(brand) }));
    p.save();
    return p;
  }

  static open(dir: string): Project {
    const m = ProjectManifest.parse(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")));
    return new Project(path.resolve(dir), m);
  }

  sub(name: (typeof PROJECT_DIRS)[number]): string {
    return path.join(this.dir, name);
  }

  set(key: string, ref: Partial<ArtifactRef> & { path: string }): void {
    const prev = this.manifest.artifacts[key];
    this.manifest.artifacts[key] = ArtifactRef.parse({ ...prev, ...ref, version: prev ? prev.version + 1 : 1, updated_at: new Date().toISOString() });
    this.save();
  }

  get(key: string): ArtifactRef | undefined {
    return this.manifest.artifacts[key];
  }

  require(key: string): string {
    const a = this.manifest.artifacts[key];
    if (!a || a.status !== "ok") throw new Error(`Project artifact "${key}" is not ready (${a?.status ?? "missing"}). Run the producing agent first.`);
    return a.path;
  }

  note(agent: string, message: string): void {
    this.manifest.log.push({ at: new Date().toISOString(), agent, message });
    this.save();
  }

  save(): void {
    fs.writeFileSync(path.join(this.dir, "project.json"), JSON.stringify(this.manifest, null, 2));
  }

  /** Path relative to the project dir (Remotion publicDir). */
  rel(p: string): string {
    return path.relative(this.dir, p);
  }
}
