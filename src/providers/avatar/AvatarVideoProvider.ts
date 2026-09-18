import type { ProviderHealth } from "../voice/VoiceProvider.js";

/**
 * Generic speaking-presenter (avatar) video interface. The pipeline hands the
 * provider the FINAL approved narration audio plus a reference image and a
 * prompt, and receives a lip-synced video. Implementations: LongCat, future
 * providers. The Shorts Director never depends on a concrete implementation.
 */

export type AvatarResolution = "480p" | "720p" | "1080p";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3";

export interface AvatarCapabilities {
  /** True when the model lip-syncs to supplied audio (required for this pipeline). */
  audio_driven: boolean;
  resolutions: AvatarResolution[];
  /** Aspect ratios the model can natively output. The compositor crops if the panel differs. */
  native_aspect_ratios: AspectRatio[];
  fps: number[];
  /** Maximum single-shot duration in seconds (providers chain segments beyond this). */
  max_duration_sec: number;
  supports_negative_prompt: boolean;
  supports_seed: boolean;
  /** Where inference runs. */
  runtime: "local_gpu" | "remote_gpu" | "hosted_api";
}

export interface AvatarGenerationRequest {
  /** Reference character image (PNG/JPG). */
  referenceImage: string;
  /** Narration audio that drives lip sync. */
  audioPath: string;
  /** Scene / character prompt. */
  prompt: string;
  negativePrompt?: string;
  /** Directory the provider may write intermediate and final files into. */
  outDir: string;
  /** Desired duration; normally the narration length. */
  durationSec: number;
  resolution?: AvatarResolution;
  fps?: number;
  aspectRatio?: AspectRatio;
  seed?: number;
  /** Progress callback receiving raw log lines. */
  onLog?: (line: string) => void;
}

export interface AvatarGenerationResult {
  path: string;
  width: number;
  height: number;
  fps: number;
  duration_sec: number;
  provider: string;
  /** Actual aspect ratio delivered; the compositor uses this to plan cropping. */
  aspect_ratio: AspectRatio;
  /** Provider-specific metadata (command line, segments, seed). */
  meta?: Record<string, unknown>;
}

export interface AvatarVideoProvider {
  readonly name: string;
  capabilities(): AvatarCapabilities;
  health(): Promise<ProviderHealth>;
  generate(req: AvatarGenerationRequest): Promise<AvatarGenerationResult>;
}
