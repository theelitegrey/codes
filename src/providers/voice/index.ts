import { env } from "../../core/env.js";
import type { VoiceConfig } from "../../config/voices.js";
import { LocalTTSProvider } from "./LocalTTSProvider.js";
import { VoiceStudioProvider } from "./VoiceStudioProvider.js";
import { HeyGenVoiceProvider } from "./HeyGenVoiceProvider.js";
import type { VoiceProvider } from "./VoiceProvider.js";

export type { VoiceProvider, SynthesisRequest, SynthesisResult, VoiceInfo, ProviderHealth, Transcription } from "./VoiceProvider.js";
export { VoiceStudioProvider } from "./VoiceStudioProvider.js";
export { LocalTTSProvider } from "./LocalTTSProvider.js";
export { HeyGenVoiceProvider } from "./HeyGenVoiceProvider.js";

export type VoiceProviderFactory = () => VoiceProvider;

/**
 * Registry: add a new provider by registering a factory under a name and
 * referencing that name from a voice config's `provider` field or
 * VOICE_PROVIDER env. The Shorts Director never imports concrete providers.
 */
const registry = new Map<string, VoiceProviderFactory>([
  ["heygen", () => new HeyGenVoiceProvider()],
  ["voicestudio", () => new VoiceStudioProvider()],
  ["local", () => new LocalTTSProvider()],
]);

export function registerVoiceProvider(name: string, factory: VoiceProviderFactory): void {
  registry.set(name, factory);
}

export function listVoiceProviders(): string[] {
  return [...registry.keys()];
}

/** Pick the provider for a voice config (voice.provider wins, then VOICE_PROVIDER env, then voicestudio). */
export function createVoiceProvider(voice?: Pick<VoiceConfig, "provider">, override?: string): VoiceProvider {
  const name = override ?? voice?.provider ?? env("VOICE_PROVIDER", "heygen")!;
  const f = registry.get(name);
  if (!f) throw new Error(`Unknown voice provider "${name}". Registered: ${listVoiceProviders().join(", ")}`);
  return f();
}
