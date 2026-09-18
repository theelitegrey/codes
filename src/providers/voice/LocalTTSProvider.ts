import path from "node:path";
import { commandExists, ensureDir, probe, run, ffmpegBin } from "../../media/ffmpeg.js";
import type { ProviderHealth, SynthesisRequest, SynthesisResult, VoiceInfo, VoiceProvider } from "./VoiceProvider.js";

/**
 * Offline fallback using system TTS (espeak-ng on Linux, `say` on macOS).
 * Quality is placeholder-grade; it exists so the whole pipeline can be
 * exercised end-to-end without VoiceStudio running.
 */
export class LocalTTSProvider implements VoiceProvider {
  readonly name = "local";

  private async engine(): Promise<"espeak-ng" | "espeak" | "say" | null> {
    if (await commandExists("espeak-ng")) return "espeak-ng";
    if (await commandExists("espeak")) return "espeak";
    if (process.platform === "darwin" && (await commandExists("say"))) return "say";
    return null;
  }

  async health(): Promise<ProviderHealth> {
    const e = await this.engine();
    return e ? { ok: true, detail: `local TTS via ${e}` } : { ok: false, detail: "No local TTS engine found (install espeak-ng, or use macOS `say`)." };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const e = await this.engine();
    if (e === "espeak-ng" || e === "espeak") {
      const r = await run(e, ["--voices"]);
      return r.stdout
        .split("\n")
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter((c) => c.length >= 4)
        .map((c) => ({ id: c[1], name: c[3], language: c[1], engine: e }));
    }
    if (e === "say") {
      const r = await run("say", ["-v", "?"]);
      return r.stdout.split("\n").filter(Boolean).map((l) => {
        const [name, lang] = l.trim().split(/\s+/);
        return { id: name, name, language: lang, engine: "say" };
      });
    }
    return [];
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const e = await this.engine();
    if (!e) throw new Error("No local TTS engine available");
    ensureDir(path.dirname(req.outPath));
    const tmp = req.outPath.replace(/\.[a-z0-9]+$/i, ".raw.wav");
    if (e === "say") {
      const aiff = tmp.replace(/\.wav$/, ".aiff");
      const r = await run("say", ["-v", req.voice.voice_id === "default" ? "Samantha" : req.voice.voice_id, "-r", String(Math.round(175 * req.voice.speaking_speed)), "-o", aiff, req.text]);
      if (r.code !== 0) throw new Error(`say failed: ${r.stderr}`);
      await run(ffmpegBin(), ["-y", "-i", aiff, tmp]);
    } else {
      const speed = String(Math.round(160 * req.voice.speaking_speed));
      const voice = req.voice.voice_id === "default" ? "en" : req.voice.voice_id;
      const r = await run(e, ["-v", voice, "-s", speed, "-w", tmp, req.text]);
      if (r.code !== 0) throw new Error(`${e} failed: ${r.stderr}`);
    }
    const conv = await run(ffmpegBin(), ["-y", "-i", tmp, "-ar", "48000", "-ac", "1", req.outPath]);
    if (conv.code !== 0) throw new Error(`ffmpeg convert failed: ${conv.stderr.slice(-500)}`);
    const info = await probe(req.outPath);
    return { path: req.outPath, duration_sec: info.duration_sec, format: req.voice.output_format, provider: this.name, voice_id: req.voice.voice_id };
  }
}
