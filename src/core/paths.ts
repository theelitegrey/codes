import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (works from src/ via tsx and from dist/ after build). */
export const REPO_ROOT = path.resolve(here, "..", "..");
export const CONFIG_DIR = path.join(REPO_ROOT, "config");
export const PRESENTER_CONFIG_DIR = path.join(CONFIG_DIR, "presenter");
export const VOICE_CONFIG_DIR = path.join(CONFIG_DIR, "voice");
export const PRESET_CONFIG_DIR = path.join(CONFIG_DIR, "presets");
export const REMOTION_ENTRY = path.join(REPO_ROOT, "remotion", "index.ts");
