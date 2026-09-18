import { z } from "zod";
import { LLM } from "../../providers/llm/llm.js";
import { ShortRequest } from "../../core/project.js";
import { PresenterProfileStore } from "../../config/presenters.js";
import { VoiceConfigStore } from "../../config/voices.js";
import { parseModeFromText } from "../../presets/modes.js";
import { CHANNEL_BRIEF } from "./prompts.js";

const IntakeSchema = z.object({
  topic: z.string(),
  target_duration_sec: z.number().min(10).max(180).nullable(),
  audience: z.string().nullable(),
  language: z.string().nullable(),
  extra_instructions: z.string().nullable(),
});

/** Deterministic duration parse: "45-second", "45s", "1 minute", "90 sec". */
export function parseDurationFromText(text: string): number | undefined {
  const t = text.toLowerCase();
  const m = t.match(/(\d{2,3})\s*(?:-|\s)?\s*(?:second|sec|s)\b/);
  if (m) return Number(m[1]);
  const mm = t.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(?:minute|min)\b/);
  if (mm) return Math.round(Number(mm[1]) * 60);
  return undefined;
}

/**
 * Turn "Create a 45-second Short explaining NQ liquidity sweeps. Use my
 * default presenter." into a ShortRequest. Presenter/voice/mode are resolved
 * deterministically against the config stores; the LLM extracts the topic.
 */
export async function intakeAgent(llm: LLM | null, userText: string, stores: { presenters: PresenterProfileStore; voices: VoiceConfigStore }, overrides: Partial<ShortRequest> = {}): Promise<ShortRequest> {
  const presenter = stores.presenters.resolveFromText(userText);
  const voice = stores.voices.resolveFromText(userText);
  const mode = parseModeFromText(userText);
  const duration = parseDurationFromText(userText);

  let extracted: z.infer<typeof IntakeSchema>;
  if (llm) {
    extracted = await llm.structured(
      IntakeSchema,
      `${CHANNEL_BRIEF}\nExtract the request. "topic" is the subject to explain, phrased as a short noun phrase without instructions about presenters, voices, modes or duration. Leave fields null when not stated.`,
      userText,
      { effort: "low", maxTokens: 2000 }
    );
  } else {
    extracted = { topic: stripInstructionPhrases(userText), target_duration_sec: null, audience: null, language: null, extra_instructions: null };
  }

  return ShortRequest.parse({
    topic: overrides.topic ?? extracted.topic,
    target_duration_sec: overrides.target_duration_sec ?? duration ?? extracted.target_duration_sec ?? 45,
    mode: overrides.mode ?? mode ?? "PODCAST_SHORT",
    presenter_id: overrides.presenter_id ?? presenter?.id ?? stores.presenters.loadRegistry().default,
    voice_id: overrides.voice_id ?? voice?.id ?? presenter?.default_voice_id ?? "default",
    audience: overrides.audience ?? extracted.audience ?? undefined,
    language: overrides.language ?? extracted.language ?? undefined,
    extra_instructions: overrides.extra_instructions ?? extracted.extra_instructions ?? undefined,
  });
}

export function stripInstructionPhrases(text: string): string {
  return text
    .replace(/\buse (my |the )?[a-z_ ]*(presenter|host|voice|avatar)\b\.?/gi, "")
    .replace(/\b(create|make|produce|generate) (a|an) (\d+(?:\.\d+)?[- ]?(second|sec|s|minute|min)s? )?short\b(?: (explaining|about|on))?/gi, "")
    .replace(/\b(podcast|fullscreen|news|trading|educational|cinematic) mode\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:-]+|[\s.,:-]+$/g, "")
    .trim();
}
