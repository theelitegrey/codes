import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../core/paths.js";
import { env } from "../../core/env.js";
import { ModelRegistry, type RegistryModel } from "./schema.js";

export function loadRegistry(file: string = path.join(CONFIG_DIR, "models", "registry.json")): RegistryModel[] {
  return ModelRegistry.parse(JSON.parse(fs.readFileSync(file, "utf8"))).models;
}

export interface SelectionConstraints {
  kind: "image" | "video";
  commercial: boolean;
  quality_min: number;
  consistency_min: number;
  /** Local VRAM in GB; local adapters needing more are excluded. */
  vram_gb: number;
  /** Adapter availability as probed on this host. */
  available: Record<string, boolean>;
  /** Weighting: default favours quality, then consistency, then speed. */
  weights?: { quality: number; speed: number; consistency: number };
}

export interface Scored {
  model: RegistryModel;
  score: number;
  reasons: string[];
}

/** Deterministic registry selection: filter on hard constraints, then rank. */
export function selectModel(models: RegistryModel[], c: SelectionConstraints): { chosen?: Scored; rejected: Scored[] } {
  const w = c.weights ?? { quality: 3, speed: 1, consistency: 2 };
  const rejected: Scored[] = [];
  const ok: Scored[] = [];
  for (const m of models) {
    const reasons: string[] = [];
    if (m.kind !== c.kind) continue;
    if (c.commercial && !m.commercial_ok) reasons.push(`license ${m.license} is not commercial`);
    if (m.quality < c.quality_min) reasons.push(`quality ${m.quality} < ${c.quality_min}`);
    if (m.consistency < c.consistency_min) reasons.push(`consistency ${m.consistency} < ${c.consistency_min}`);
    if (m.adapter !== "hf_inference" && m.vram_gb > c.vram_gb) reasons.push(`needs ${m.vram_gb} GB VRAM, host has ${c.vram_gb}`);
    if (!c.available[m.adapter]) reasons.push(`adapter ${m.adapter} not available`);
    const score = w.quality * m.quality + w.speed * m.speed + w.consistency * m.consistency;
    (reasons.length ? rejected : ok).push({ model: m, score, reasons });
  }
  ok.sort((a, b) => b.score - a.score);
  return { chosen: ok[0], rejected };
}

export function hostVramGb(): number {
  const v = Number(env("ILLUSTRATION_VRAM_GB", "0"));
  return Number.isFinite(v) ? v : 0;
}
