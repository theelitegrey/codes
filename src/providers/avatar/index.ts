import { env } from "../../core/env.js";
import { LongCatAvatarProvider } from "./LongCatAvatarProvider.js";
import { NoAvatarProvider } from "./NoAvatarProvider.js";
import type { AvatarVideoProvider } from "./AvatarVideoProvider.js";

export type { AvatarVideoProvider, AvatarGenerationRequest, AvatarGenerationResult, AvatarCapabilities, AvatarResolution, AspectRatio } from "./AvatarVideoProvider.js";
export { LongCatAvatarProvider, segmentsForDuration, generatedDuration, LONGCAT_FPS, LONGCAT_RESOLUTIONS } from "./LongCatAvatarProvider.js";
export { NoAvatarProvider } from "./NoAvatarProvider.js";

export type AvatarProviderFactory = () => AvatarVideoProvider;

const registry = new Map<string, AvatarProviderFactory>([
  ["longcat", () => new LongCatAvatarProvider()],
  ["none", () => new NoAvatarProvider()],
]);

export function registerAvatarProvider(name: string, factory: AvatarProviderFactory): void {
  registry.set(name, factory);
}

export function listAvatarProviders(): string[] {
  return [...registry.keys()];
}

export function createAvatarProvider(override?: string): AvatarVideoProvider {
  const name = override ?? env("AVATAR_PROVIDER", "longcat")!;
  const f = registry.get(name);
  if (!f) throw new Error(`Unknown avatar provider "${name}". Registered: ${listAvatarProviders().join(", ")}`);
  return f();
}
