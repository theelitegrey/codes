import type { ProviderHealth } from "../voice/VoiceProvider.js";
import type { AvatarCapabilities, AvatarGenerationRequest, AvatarGenerationResult, AvatarVideoProvider } from "./AvatarVideoProvider.js";

/** Disabled presenter: the compositor renders presenter-less scenes. */
export class NoAvatarProvider implements AvatarVideoProvider {
  readonly name = "none";
  capabilities(): AvatarCapabilities {
    return { audio_driven: false, resolutions: [], native_aspect_ratios: [], fps: [], max_duration_sec: 0, supports_negative_prompt: false, supports_seed: false, runtime: "local_gpu" };
  }
  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "presenter generation disabled (AVATAR_PROVIDER=none)" };
  }
  async generate(_req: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    throw new Error("Avatar generation is disabled (AVATAR_PROVIDER=none)");
  }
}
