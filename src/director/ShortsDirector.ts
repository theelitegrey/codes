import { LLM } from "../providers/llm/llm.js";
import { PresenterProfileStore } from "../config/presenters.js";
import { VoiceConfigStore } from "../config/voices.js";
import { createVoiceProvider } from "../providers/voice/index.js";
import { createAvatarProvider } from "../providers/avatar/index.js";
import { createVisualProvider } from "../providers/visuals/index.js";
import type { VoiceProvider } from "../providers/voice/VoiceProvider.js";
import type { AvatarVideoProvider } from "../providers/avatar/AvatarVideoProvider.js";
import type { VisualAssetProvider } from "../providers/visuals/VisualAssetProvider.js";
import { intakeAgent } from "../agents/legacy/intake.js";
import { runPipeline, type PipelineOptions } from "../pipeline/runPipeline.js";
import type { ProjectState, ShortRequest } from "../core/project.js";

/**
 * Master Shorts Director. Entry point for "Create a 45-second Short
 * explaining X. Use my default presenter." It resolves configuration, wires
 * the generic providers and runs the pipeline. It only ever sees the
 * VoiceProvider / AvatarVideoProvider / VisualAssetProvider interfaces.
 */
export interface DirectorDeps {
  llm?: LLM;
  voice?: VoiceProvider;
  avatar?: AvatarVideoProvider;
  visuals?: VisualAssetProvider;
  presenters?: PresenterProfileStore;
  voices?: VoiceConfigStore;
}

export class ShortsDirector {
  private readonly llm: LLM;
  private readonly presenters: PresenterProfileStore;
  private readonly voices: VoiceConfigStore;
  private readonly avatar: AvatarVideoProvider;
  private readonly visuals: VisualAssetProvider;
  private readonly voiceOverride?: VoiceProvider;

  constructor(deps: DirectorDeps = {}) {
    this.llm = deps.llm ?? new LLM();
    this.presenters = deps.presenters ?? new PresenterProfileStore();
    this.voices = deps.voices ?? new VoiceConfigStore();
    this.avatar = deps.avatar ?? createAvatarProvider();
    this.visuals = deps.visuals ?? createVisualProvider();
    this.voiceOverride = deps.voice;
  }

  /** Parse a natural-language request into a structured ShortRequest. */
  async intake(userText: string, overrides: Partial<ShortRequest> = {}): Promise<ShortRequest> {
    return intakeAgent(this.llm, userText, { presenters: this.presenters, voices: this.voices }, overrides);
  }

  /** Full run from a natural-language instruction. */
  async create(userText: string, opts: PipelineOptions & { overrides?: Partial<ShortRequest> } = {}): Promise<ProjectState> {
    const request = await this.intake(userText, opts.overrides);
    return this.run(request, opts);
  }

  /** Run from an already-structured request. */
  async run(request: ShortRequest, opts: PipelineOptions = {}): Promise<ProjectState> {
    const voiceConfig = this.voices.get(request.voice_id);
    const voice = this.voiceOverride ?? createVoiceProvider(voiceConfig);
    return runPipeline(request, { llm: this.llm, voice, avatar: this.avatar, visuals: this.visuals, presenters: this.presenters, voices: this.voices }, opts);
  }
}
