import type { VoiceConfig } from "../../config/voices.js";

/**
 * Generic voice/narration interface. Agents and the Shorts Director depend on
 * this contract only; concrete implementations (VoiceStudio, local TTS, ...)
 * are swapped through the provider registry.
 */

export interface ProviderHealth {
  ok: boolean;
  detail: string;
  /** Extra diagnostics (versions, device, engine). */
  info?: Record<string, unknown>;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language?: string;
  engine?: string;
  /** Raw provider payload for debugging. */
  raw?: unknown;
}

export interface SynthesisRequest {
  text: string;
  voice: VoiceConfig;
  /** Absolute output path. Extension must match voice.output_format. */
  outPath: string;
}

export interface SynthesisResult {
  path: string;
  duration_sec: number;
  format: string;
  provider: string;
  voice_id: string;
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcription {
  text: string;
  words: TranscriptionWord[];
  language?: string;
}

export interface VoiceProvider {
  readonly name: string;
  health(): Promise<ProviderHealth>;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  /** Optional: word-level transcription used for caption timing. */
  transcribe?(audioPath: string, language?: string): Promise<Transcription>;
}
