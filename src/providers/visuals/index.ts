import { env } from "../../core/env.js";
import { LocalLibraryVisualProvider } from "./LocalLibraryVisualProvider.js";
import type { VisualAssetProvider } from "./VisualAssetProvider.js";

export type { VisualAssetProvider, VisualAssetRequest, VisualAssetResult } from "./VisualAssetProvider.js";
export { LocalLibraryVisualProvider } from "./LocalLibraryVisualProvider.js";

const registry = new Map<string, () => VisualAssetProvider>([["local_library", () => new LocalLibraryVisualProvider()]]);

export function registerVisualProvider(name: string, factory: () => VisualAssetProvider): void {
  registry.set(name, factory);
}

export function createVisualProvider(override?: string): VisualAssetProvider {
  const name = override ?? env("VISUAL_PROVIDER", "local_library")!;
  const f = registry.get(name);
  if (!f) throw new Error(`Unknown visual provider "${name}". Registered: ${[...registry.keys()].join(", ")}`);
  return f();
}
