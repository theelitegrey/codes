import type { MainVisual } from "../../core/scene.js";

/**
 * Supplies media files for scene visuals that need an asset (broll, image,
 * ai_visual, screen_recording). Charts, headlines and graphics are rendered
 * directly by the Remotion composition from scene data and need no asset.
 */
export interface VisualAssetRequest {
  sceneId: number;
  visual: MainVisual;
  durationSec: number;
  outDir: string;
  /** Target panel size (the upper area of the frame). */
  width: number;
  height: number;
}

export interface VisualAssetResult {
  /** Absolute path to an mp4/png/jpg, or undefined when the provider has nothing (renderer falls back to a generated graphic). */
  path?: string;
  kind: "video" | "image" | "none";
  provider: string;
}

export interface VisualAssetProvider {
  readonly name: string;
  resolve(req: VisualAssetRequest): Promise<VisualAssetResult>;
}
